import { Link, Route, Routes, useLocation } from 'react-router-dom'
import Inicio from './pages/Inicio'
import NovaAta from './pages/NovaAta'
import Processando from './pages/Processando'
import RevisarTranscricao from './pages/RevisarTranscricao'
import RevisarAta from './pages/RevisarAta'
import Imprimir from './pages/Imprimir'
import Configuracoes from './pages/Configuracoes'
import { useSettings } from './hooks'
import MarcaApp from './components/MarcaApp'
import Sobre from './pages/Sobre'
import { SETTINGS_PADRAO } from './types'

export default function App() {
  const { pathname } = useLocation()
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [pathname])
  const [settings] = useSettings()
  const etapa = pathname === '/nova' ? 0 : pathname.includes('/imprimir') ? 3 : pathname.includes('/revisar') || pathname.endsWith('/processando/ata') ? 2 : 1
  const emFluxo = pathname === '/nova' || pathname.startsWith('/ata/')
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3">Ir para o conteúdo</a>
      <header className="border-b-4 border-amber-300 bg-ink text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-8 sm:py-5">
          <Link to="/" className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg sm:w-auto sm:flex-1">
            <span className="w-36 shrink-0 rounded-lg bg-white p-1 sm:w-44"><MarcaApp compacta className="h-auto w-full" /></span>
            <span className="min-w-0"><span className="mb-1 block text-xs uppercase tracking-widest text-slate-200">EMPLMS</span><span className="block font-document text-base font-semibold leading-snug sm:text-lg">{settings?.escola || SETTINGS_PADRAO.escola}</span></span>
          </Link>
          <nav aria-label="Navegação principal" className="flex gap-1">
            <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className="flex min-h-12 items-center rounded-lg px-3 hover:bg-white/10 aria-[current=page]:bg-white/10">Início</Link>
            <Link to="/config" aria-current={pathname === '/config' ? 'page' : undefined} className="flex min-h-12 items-center rounded-lg px-3 hover:bg-white/10 aria-[current=page]:bg-white/10">Configurações</Link>
            <Link to="/sobre" aria-current={pathname === '/sobre' ? 'page' : undefined} className="flex min-h-12 items-center rounded-lg px-3 hover:bg-white/10 aria-[current=page]:bg-white/10">Sobre</Link>
          </nav>
        </div>
      </header>
      {emFluxo && <nav aria-label="Etapas da ata" className="border-b border-rule bg-white">
        <ol className="mx-auto grid max-w-3xl grid-cols-4 px-3 py-4 text-center text-base">
          {['Dados', 'Transcrição', 'Ata', 'Imprimir'].map((nome, i) => <li key={nome} aria-current={i === etapa ? 'step' : undefined} className={`${i < etapa ? 'step-done' : ''} ${i === etapa ? 'font-semibold text-blue-900' : 'text-slate-600'}`}><span className="step-number" aria-hidden="true">{i < etapa ? '✓' : i + 1}</span>{nome}</li>)}
        </ol>
      </nav>}
      <main id="conteudo" className="mx-auto w-full max-w-3xl flex-1 px-4 py-7 pb-32 sm:px-8 sm:py-10 sm:pb-32">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/nova" element={<NovaAta />} />
          <Route path="/ata/:id/processando/:etapa" element={<Processando />} />
          <Route path="/ata/:id/transcricao" element={<RevisarTranscricao />} />
          <Route path="/ata/:id/revisar" element={<RevisarAta />} />
          <Route path="/ata/:id/imprimir" element={<Imprimir />} />
          <Route path="/config" element={<Configuracoes />} />
          <Route path="/sobre" element={<Sobre />} />
          <Route path="*" element={<Inicio />} />
        </Routes>
      </main>
      <footer className="mx-auto w-full max-w-3xl px-4 pb-6 text-center text-base text-slate-600">Ata Inteligente · Arquivo salvo neste aparelho</footer>
    </div>
  )
}
import { useLayoutEffect } from 'react'
