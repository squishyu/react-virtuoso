import { expect, test } from '@playwright/test'

//@ts-expect-error - type module and playwright
import { navigateToExample } from './utils.ts'

test.describe('list with collapsible long items', () => {
  test.beforeEach(async ({ baseURL, page }) => {
    await navigateToExample(page, baseURL, 'collapsible-long-item')
    await page.waitForSelector('[data-testid=virtuoso-scroller]')
    await page.waitForTimeout(500)
  })

  test.skip('compensates correctly when collapsing an item', async ({ page }) => {
    await page.waitForSelector('[data-testid=virtuoso-scroller]')
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid=virtuoso-scroller]')!
      scroller.scrollBy({ top: -400 })
    })

    await page.waitForTimeout(500)
    await page.waitForSelector('[data-index="90"] button')

    await page.evaluate(() => {
      const button = document.querySelector('[data-index="90"] button') as HTMLElement
      button.click()
    })

    await page.waitForTimeout(200)

    const scrollTop = await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid=virtuoso-scroller]')!
      return scroller.scrollTop
    })

    expect(scrollTop).toBe(9200)
  })
})
