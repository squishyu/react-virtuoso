import React, { isValidElement, type ReactNode } from 'react'
import useIsBrowser from '@docusaurus/useIsBrowser'
import ElementContent from '@theme/CodeBlock/Content/Element'
import StringContent from '@theme/CodeBlock/Content/String'
import type { Props } from '@theme/CodeBlock'
import BrowserOnly from '@docusaurus/BrowserOnly'

/**
 * Best attempt to make the children a plain string so it is copyable. If there
 * are react elements, we will not be able to copy the content, and it will
 * return `children` as-is; otherwise, it concatenates the string children
 * together.
 */
function maybeStringifyChildren(children: ReactNode): ReactNode {
  if (React.Children.toArray(children).some((el) => isValidElement(el))) {
    return children
  }
  // The children is now guaranteed to be one/more plain strings
  return Array.isArray(children) ? children.join('') : (children as string)
}

export default function CodeBlock({ children: rawChildren, ...props }: Props): ReactNode {
  // The Prism theme on SSR is always the default theme but the site theme can
  // be in a different mode. React hydration doesn't update DOM styles that come
  // from SSR. Hence force a re-render after mounting to apply the current
  // relevant styles.
  const isBrowser = useIsBrowser()
  const children = maybeStringifyChildren(rawChildren)
  const CodeBlockComp = typeof children === 'string' ? StringContent : ElementContent

  if (props.metastring?.trim().startsWith('live')) {
    const disableSandbox = props.metastring.trim().includes('noSandbox')
    return (
      <BrowserOnly fallback={<pre>loading...</pre>}>
        {() => {
          const LiveCodeBlock = require('@theme/CodeBlock/LiveCodeBlock').default
          return <LiveCodeBlock disableSandbox={disableSandbox} code={children as string} />
        }}
      </BrowserOnly>
    )
  }
  return (
    <CodeBlockComp key={String(isBrowser)} {...props}>
      {children as string}
    </CodeBlockComp>
  )
}
