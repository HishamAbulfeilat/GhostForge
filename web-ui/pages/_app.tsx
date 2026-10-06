// Pages Router shell. Only pages/agent-world/town-frame uses it: the a16z AI
// Town renderer (@pixi/react 7) needs React 18, and the App Router always runs
// Next's bundled React 19, so the town renders here inside an iframe.
import type { AppProps } from 'next/app'
import '../app/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
