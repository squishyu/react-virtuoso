import { rangeComparator, tupleComparator } from './comparators'
import { ElementDimensions, Gap, GridStateSnapshot } from './component-interfaces/VirtuosoGrid'
import { domIOSystem } from './domIOSystem'
import { getInitialTopMostItemIndexNumber } from './initialTopMostItemIndexSystem'
import { FlatIndexLocationWithAlign, GridIndexLocation, GridItem } from './interfaces'
import { loggerSystem } from './loggerSystem'
import { propsReadySystem } from './propsReadySystem'
import { scrollSeekSystem } from './scrollSeekSystem'
import { normalizeIndexLocation } from './scrollToIndexSystem'
import { sizeRangeSystem } from './sizeRangeSystem'
import { stateFlagsSystem } from './stateFlagsSystem'
import * as u from './urx'
import { skipFrames } from './utils/skipFrames'
import { windowScrollerSystem } from './windowScrollerSystem'

export type Data = null | unknown[]

export interface GridLayout {
  bottom: number
  top: number
}

export interface GridState extends GridLayout {
  itemHeight: number
  items: GridItem<unknown>[]
  itemWidth: number
  offsetBottom: number
  offsetTop: number
}

const INITIAL_GRID_STATE: GridState = {
  bottom: 0,
  itemHeight: 0,
  items: [],
  itemWidth: 0,
  offsetBottom: 0,
  offsetTop: 0,
  top: 0,
}

const PROBE_GRID_STATE: GridState = {
  bottom: 0,
  itemHeight: 0,
  items: [{ index: 0 }],
  itemWidth: 0,
  offsetBottom: 0,
  offsetTop: 0,
  top: 0,
}

const { ceil, floor, max, min, round } = Math

function buildItems<D>(startIndex: number, endIndex: number, data: D[] | null) {
  return Array.from({ length: endIndex - startIndex + 1 }).map((_, i) => {
    const dataItem = data === null ? null : data[i + startIndex]
    return { data: dataItem, index: i + startIndex } as GridItem<D>
  })
}

function buildProbeGridState<D = unknown>(items: GridItem<D>[]): GridState {
  return {
    ...PROBE_GRID_STATE,
    items: items,
  }
}

function dimensionComparator(prev: ElementDimensions, next: ElementDimensions) {
  return prev && prev.width === next.width && prev.height === next.height
}
function gapComparator(prev: Gap, next: Gap) {
  return prev && prev.column === next.column && prev.row === next.row
}

export const gridSystem = /*#__PURE__*/ u.system(
  ([
    { increaseViewportBy, listBoundary, overscan, visibleRange },
    { footerHeight, headerHeight, scrollBy, scrollContainerState, scrollTo, scrollTop, smoothScrollTargetReached, viewportHeight },
    stateFlags,
    scrollSeek,
    { didMount, propsReady },
    { customScrollParent, useWindowScroll, windowScrollContainerState, windowScrollTo, windowViewportRect },
    log,
  ]) => {
    const totalCount = u.statefulStream(0)
    const initialItemCount = u.statefulStream(0)
    const gridState = u.statefulStream(INITIAL_GRID_STATE)
    const viewportDimensions = u.statefulStream<ElementDimensions>({ height: 0, width: 0 })
    const itemDimensions = u.statefulStream<ElementDimensions>({ height: 0, width: 0 })
    const scrollToIndex = u.stream<GridIndexLocation>()
    const scrollHeight = u.stream<number>()
    const deviation = u.statefulStream(0)
    const data = u.statefulStream<Data>(null)
    const gap = u.statefulStream<Gap>({ column: 0, row: 0 })
    const stateChanged = u.stream<GridStateSnapshot>()
    const restoreStateFrom = u.stream<GridStateSnapshot | null | undefined>()
    const stateRestoreInProgress = u.statefulStream(false)
    const initialTopMostItemIndex = u.statefulStream<GridIndexLocation>(0)
    const scrolledToInitialItem = u.statefulStream(true)
    const scrollScheduled = u.statefulStream(false)
    const horizontalDirection = u.statefulStream(false)

    u.subscribe(
      u.pipe(
        didMount,
        u.withLatestFrom(initialTopMostItemIndex),
        u.filter(([_, location]) => !!location)
      ),
      () => {
        u.publish(scrolledToInitialItem, false)
      }
    )

    u.subscribe(
      u.pipe(
        u.combineLatest(didMount, scrolledToInitialItem, itemDimensions, viewportDimensions, initialTopMostItemIndex, scrollScheduled),
        u.filter(([didMount, scrolledToInitialItem, itemDimensions, viewportDimensions, , scrollScheduled]) => {
          return didMount && !scrolledToInitialItem && itemDimensions.height !== 0 && viewportDimensions.height !== 0 && !scrollScheduled
        })
      ),
      ([, , , , initialTopMostItemIndex]) => {
        u.publish(scrollScheduled, true)

        skipFrames(1, () => {
          u.publish(scrollToIndex, initialTopMostItemIndex)
        })

        u.handleNext(u.pipe(scrollTop), () => {
          // this refreshes the sizeRangeSystem start/endOffset
          u.publish(listBoundary, [0, 0])
          // console.log('resume rendering')
          u.publish(scrolledToInitialItem, true)
        })
      }
    )

    // state snapshot takes precedence over initial item count
    u.connect(
      u.pipe(
        restoreStateFrom,
        u.filter((value) => value !== undefined && value !== null && value.scrollTop > 0),
        u.mapTo(0)
      ),
      initialItemCount
    )

    u.subscribe(
      u.pipe(
        didMount,
        u.withLatestFrom(restoreStateFrom),
        u.filter(([, snapshot]) => snapshot !== undefined && snapshot !== null)
      ),
      ([, snapshot]) => {
        if (!snapshot) {
          return
        }
        u.publish(viewportDimensions, snapshot.viewport)
        u.publish(itemDimensions, snapshot.item)
        u.publish(gap, snapshot.gap)
        if (snapshot.scrollTop > 0) {
          u.publish(stateRestoreInProgress, true)
          u.handleNext(u.pipe(scrollTop, u.skip(1)), (_value) => {
            u.publish(stateRestoreInProgress, false)
          })
          u.publish(scrollTo, { top: snapshot.scrollTop })
        }
      }
    )

    u.connect(
      u.pipe(
        viewportDimensions,
        u.map(({ height }) => height)
      ),
      viewportHeight
    )

    u.connect(
      u.pipe(
        u.combineLatest(
          u.duc(viewportDimensions, dimensionComparator),
          u.duc(itemDimensions, dimensionComparator),
          u.duc(gap, (prev, next) => prev && prev.column === next.column && prev.row === next.row),
          u.duc(scrollTop)
        ),
        u.map(([viewport, item, gap, scrollTop]) => ({
          gap,
          item,
          scrollTop,
          viewport,
        }))
      ),
      stateChanged
    )

    u.connect(
      u.pipe(
        u.combineLatest(
          u.duc(totalCount),
          visibleRange,
          u.duc(gap, gapComparator),
          u.duc(itemDimensions, dimensionComparator),
          u.duc(viewportDimensions, dimensionComparator),
          u.duc(data),
          u.duc(initialItemCount),
          u.duc(stateRestoreInProgress),
          u.duc(scrolledToInitialItem),
          u.duc(initialTopMostItemIndex)
        ),
        u.filter(([, , , , , , , stateRestoreInProgress]) => {
          return !stateRestoreInProgress
        }),
        u.map(
          ([
            totalCount,
            [startOffset, endOffset],
            gap,
            item,
            viewport,
            data,
            initialItemCount,
            ,
            scrolledToInitialItem,
            initialTopMostItemIndex,
          ]) => {
            const { column: columnGap, row: rowGap } = gap
            const { height: itemHeight, width: itemWidth } = item
            const { width: viewportWidth } = viewport

            // don't wipeout the already rendered state if there's an initial item count
            if (initialItemCount === 0 && (totalCount === 0 || viewportWidth === 0)) {
              return INITIAL_GRID_STATE
            }

            if (itemWidth === 0) {
              const startIndex = getInitialTopMostItemIndexNumber(initialTopMostItemIndex, totalCount)
              const endIndex = startIndex + Math.max(initialItemCount - 1, 0)
              return buildProbeGridState(buildItems(startIndex, endIndex, data))
            }

            const perRow = itemsPerRow(viewportWidth, itemWidth, columnGap)

            let startIndex!: number
            let endIndex!: number

            // render empty items until the scroller reaches the initial item
            if (!scrolledToInitialItem) {
              startIndex = 0
              endIndex = -1
            }
            // we know the dimensions from a restored state, but the offsets are not calculated yet
            else if (startOffset === 0 && endOffset === 0 && initialItemCount > 0) {
              startIndex = 0
              endIndex = initialItemCount - 1
            } else {
              startIndex = perRow * floor((startOffset + rowGap) / (itemHeight + rowGap))
              endIndex = perRow * ceil((endOffset + rowGap) / (itemHeight + rowGap)) - 1
              endIndex = min(totalCount - 1, max(endIndex, perRow - 1))
              startIndex = min(endIndex, max(0, startIndex))
            }

            const items = buildItems(startIndex, endIndex, data)
            const { bottom, top } = gridLayout(viewport, gap, item, items)
            const rowCount = ceil(totalCount / perRow)
            const totalHeight = rowCount * itemHeight + (rowCount - 1) * rowGap
            const offsetBottom = totalHeight - bottom

            return { bottom, itemHeight, items, itemWidth, offsetBottom, offsetTop: top, top } as GridState
          }
        )
      ),
      gridState
    )

    u.connect(
      u.pipe(
        data,
        u.filter((data) => data !== null),
        u.map((data) => data!.length)
      ),
      totalCount
    )

    u.connect(
      u.pipe(
        u.combineLatest(viewportDimensions, itemDimensions, gridState, gap),
        u.filter(([viewportDimensions, itemDimensions, { items }]) => {
          return items.length > 0 && itemDimensions.height !== 0 && viewportDimensions.height !== 0
        }),
        u.map(([viewportDimensions, itemDimensions, { items }, gap]) => {
          const { bottom, top } = gridLayout(viewportDimensions, gap, itemDimensions, items)

          return [top, bottom] as [number, number]
        }),
        u.distinctUntilChanged(tupleComparator)
      ),
      listBoundary
    )

    const hasScrolled = u.statefulStream(false)

    u.connect(
      u.pipe(
        scrollTop,
        u.withLatestFrom(hasScrolled),
        u.map(([scrollTop, hasScrolled]) => {
          return hasScrolled || scrollTop !== 0
        })
      ),
      hasScrolled
    )

    const endReached = u.streamFromEmitter(
      u.pipe(
        u.combineLatest(gridState, totalCount),
        u.filter(([{ items }]) => items.length > 0),
        u.withLatestFrom(hasScrolled),
        u.filter(([[gridState, totalCount], hasScrolled]) => {
          const lastIndex = gridState.items[gridState.items.length - 1].index
          const isLastItemRendered = lastIndex === totalCount - 1

          // User has scrolled
          if (hasScrolled) return isLastItemRendered

          // User has not scrolled, so check whether grid is fully rendered
          const isFullyRendered =
            gridState.bottom > 0 && gridState.itemHeight > 0 && gridState.offsetBottom === 0 && gridState.items.length === totalCount

          return isFullyRendered && isLastItemRendered
        }),
        u.map(([[, totalCount]]) => {
          return totalCount - 1
        }),
        u.distinctUntilChanged()
      )
    )

    const startReached = u.streamFromEmitter(
      u.pipe(
        u.duc(gridState),
        u.filter(({ items }) => {
          return items.length > 0 && items[0].index === 0
        }),

        u.mapTo(0),
        u.distinctUntilChanged()
      )
    )

    const rangeChanged = u.streamFromEmitter(
      u.pipe(
        u.duc(gridState),
        u.withLatestFrom(stateRestoreInProgress),
        u.filter(([{ items }, stateRestoreInProgress]) => items.length > 0 && !stateRestoreInProgress),
        u.map(([{ items }]) => {
          return {
            endIndex: items[items.length - 1].index,
            startIndex: items[0].index,
          }
        }),
        u.distinctUntilChanged(rangeComparator),
        u.throttleTime(0)
      )
    )

    u.connect(rangeChanged, scrollSeek.scrollSeekRangeChanged)

    u.connect(
      u.pipe(
        scrollToIndex,
        u.withLatestFrom(viewportDimensions, itemDimensions, totalCount, gap),
        u.map(([location, viewportDimensions, itemDimensions, totalCount, gap]) => {
          const normalLocation = normalizeIndexLocation(location) as FlatIndexLocationWithAlign
          const { align, behavior, offset } = normalLocation
          let index = normalLocation.index
          if (index === 'LAST') {
            index = totalCount - 1
          }

          index = max(0, index, min(totalCount - 1, index))

          let top = itemTop(viewportDimensions, gap, itemDimensions, index)

          if (align === 'end') {
            top = round(top - viewportDimensions.height + itemDimensions.height)
          } else if (align === 'center') {
            top = round(top - viewportDimensions.height / 2 + itemDimensions.height / 2)
          }

          if (offset) {
            top += offset
          }

          return { behavior, top }
        })
      ),
      scrollTo
    )

    const totalListHeight = u.statefulStreamFromEmitter(
      u.pipe(
        gridState,
        u.map((gridState) => {
          return gridState.offsetBottom + gridState.bottom
        })
      ),
      0
    )

    u.connect(
      u.pipe(
        windowViewportRect,
        u.map((viewportInfo) => ({ height: viewportInfo.visibleHeight, width: viewportInfo.visibleWidth }))
      ),
      viewportDimensions
    )

    return {
      customScrollParent,
      // input
      data,
      deviation,
      footerHeight,
      gap,
      headerHeight,
      increaseViewportBy,
      initialItemCount,
      itemDimensions,
      overscan,
      restoreStateFrom,
      scrollBy,
      scrollContainerState,
      scrollHeight,
      scrollTo,
      scrollToIndex,
      scrollTop,
      smoothScrollTargetReached,
      totalCount,
      useWindowScroll,
      viewportDimensions,
      windowScrollContainerState,
      windowScrollTo,
      windowViewportRect,
      ...scrollSeek,
      // output
      gridState,
      horizontalDirection,

      initialTopMostItemIndex,
      totalListHeight,
      ...stateFlags,
      endReached,
      propsReady,
      rangeChanged,
      startReached,
      stateChanged,
      stateRestoreInProgress,
      ...log,
    }
  },
  u.tup(sizeRangeSystem, domIOSystem, stateFlagsSystem, scrollSeekSystem, propsReadySystem, windowScrollerSystem, loggerSystem)
)

export function itemsPerRow(viewportWidth: number, itemWidth: number, gap: number) {
  return max(1, floor((viewportWidth + gap) / (floor(itemWidth) + gap)))
}

function gridLayout<D>(viewport: ElementDimensions, gap: Gap, item: ElementDimensions, items: GridItem<D>[]): GridLayout {
  const { height: itemHeight } = item
  if (itemHeight === undefined || items.length === 0) {
    return { bottom: 0, top: 0 }
  }

  const top = itemTop(viewport, gap, item, items[0].index)
  const bottom = itemTop(viewport, gap, item, items[items.length - 1].index) + itemHeight
  return { bottom, top }
}

function itemTop(viewport: ElementDimensions, gap: Gap, item: ElementDimensions, index: number) {
  const perRow = itemsPerRow(viewport.width, item.width, gap.column)
  const rowCount = floor(index / perRow)
  const top = rowCount * item.height + max(0, rowCount - 1) * gap.row
  return top > 0 ? top + gap.row : top
}
