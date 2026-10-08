'use client'

import ToastContainer from './ToastContainer'
import { useStore, type Store } from './store'
import type { Toast } from './types'

/** Renders the toast stack; subscribes to the store so toasts don't re-render the page. */
export default function ToastHost({ toasts }: { toasts: Store<Toast[]> }) {
  const list = useStore(toasts)
  return <ToastContainer toasts={list} onRemove={id => toasts.set(prev => prev.filter(t => t.id !== id))} />
}
