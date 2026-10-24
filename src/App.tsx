import { Link, Route, Routes } from 'react-router-dom'
import Inicio from './pages/Inicio'
import NovaAta from './pages/NovaAta'
import Processando from './pages/Processando'
import RevisarTranscricao from './pages/RevisarTranscricao'
import RevisarAta from './pages/RevisarAta'
import Imprimir from './pages/Imprimir'
import Configuracoes from './pages/Configuracoes'

export default function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-blue-900 px-4 py-3 text-white">
        <Link to="/" className="text-lg font-semibold">Atas Escolares</Link>
        <Link to="/config" className="rounded-lg px-3 py-2 text-sm active:bg-blue-950" aria-label="Configurações">⚙ Configurações</Link>
      </header>
      <main className="flex-1 p-4 pb-24">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/nova" element={<NovaAta />} />
          <Route path="/ata/:id/processando/:etapa" element={<Processando />} />
          <Route path="/ata/:id/transcricao" element={<RevisarTranscricao />} />
          <Route path="/ata/:id/revisar" element={<RevisarAta />} />
          <Route path="/ata/:id/imprimir" element={<Imprimir />} />
          <Route path="/config" element={<Configuracoes />} />
          <Route path="*" element={<Inicio />} />
        </Routes>
      </main>
    </div>
  )
}
