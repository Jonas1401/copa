/**
 * Enquanto o servidor reúne as fontes autorizadas (Jellyfin/M3U/TMDB, com teto
 * de 4 s), esta tela mostra o desenho da página — nenhum "branco" na abertura.
 */
export default function CopaFlixCarregando() {
  return (
    <div className="copaflix">
      <div className="cf-halo" aria-hidden />
      <header className="cf-topo">
        <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2 px-3 py-2.5 sm:px-5">
          <span className="cf-esqueleto h-9 w-9 rounded-full" />
          <span className="cf-esqueleto h-6 w-40 rounded-full" />
          <span className="cf-esqueleto ml-auto h-9 w-24 rounded-full" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] px-3 pt-4 sm:px-5" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando o CopaFlix…</span>
        <div className="cf-esqueleto mx-auto h-[210px] w-full max-w-[420px] rounded-[18px]" />
        <div className="mx-auto mt-6 h-1.5 w-24 rounded-full bg-progresso" />
        <div className="mx-auto mt-8 max-w-[720px] space-y-3">
          <div className="cf-esqueleto h-4 w-24 rounded-full" />
          <div className="cf-esqueleto h-9 w-3/4 rounded-[10px]" />
          <div className="cf-esqueleto h-3 w-full rounded-full" />
          <div className="cf-esqueleto h-3 w-5/6 rounded-full" />
        </div>
        <div className="mt-10 flex gap-2.5 overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="cf-esqueleto aspect-[2/3] w-[138px] shrink-0 rounded-[16px] sm:w-[152px]" />
          ))}
        </div>
      </main>
    </div>
  );
}
