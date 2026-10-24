import { useEffect, useRef, useState } from 'react'
import { getAta, getSettings } from './db'
import type { AtaRecord, Settings } from './types'

export function useAta(id: string | undefined) {
  const [ata, setAta] = useState<AtaRecord | null | undefined>(undefined)
  useEffect(() => {
    if (!id) return
    let vivo = true
    getAta(id).then(a => vivo && setAta(a ?? null))
    return () => { vivo = false }
  }, [id])
  return [ata, setAta] as const
}

export function useSettings() {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { getSettings().then(setS) }, [])
  return [s, setS] as const
}

/** salva depois de um instante sem digitar */
export function useDebouncedEffect(fn: () => void, deps: unknown[], ms = 600) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const t = setTimeout(() => ref.current(), ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
