import { alternarAssunto, assuntoJaUsado } from '../assuntos'

type Props = {
  sugestoes: string[]
  pauta: string[]
  onChange: (pauta: string[]) => void
}

/** chips grandes: tocar adiciona o assunto à pauta, tocar de novo remove */
export default function AssuntosSugeridos({ sugestoes, pauta, onChange }: Props) {
  if (!sugestoes.length) return null
  return (
    <div className="space-y-2">
      <p className="label">Sugestões — toque para adicionar</p>
      <ul className="flex flex-wrap gap-2">
        {sugestoes.map(a => {
          const usado = assuntoJaUsado(pauta, a)
          return (
            <li key={a}>
              <button
                type="button" aria-pressed={usado} onClick={() => onChange(alternarAssunto(pauta, a))}
                className={`min-h-11 rounded-full border px-4 py-2 text-left text-sm font-medium ${usado ? 'border-blue-900 bg-blue-900 text-white' : 'border-slate-300 bg-white text-slate-800 active:bg-slate-100'}`}
              >{usado ? '✓ ' : ''}{a}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
