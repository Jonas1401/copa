"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  LoaderCircle,
  Plus,
  Sticker,
  Trash2,
  X,
} from "lucide-react";

type CategoriaAdmin = { chave: string; nome: string; ordem: number; pacote: string };
type FigurinhaAdmin = {
  id: number;
  nome: string;
  categoria: string;
  mime: string;
  ativa: boolean;
  ordem: number;
  pacote: string;
  imagemUrl: string;
  animada: boolean;
};
type Resposta = {
  categorias?: CategoriaAdmin[];
  figurinhas?: FigurinhaAdmin[];
  figurinha?: FigurinhaAdmin;
  categoria?: CategoriaAdmin;
  erro?: string;
};
type Api = <T>(url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; dados: T }>;

const TAMANHO_MAX = 512 * 1024;
const FORMATOS = "image/png,image/webp,image/gif";

/**
 * Painel exclusivo do administrador: biblioteca de figurinhas do chat.
 * Publicou aqui, aparece na hora para todos os motoristas (catálogo central).
 */
export default function CartaoFigurinhasAdmin({ api, onSessaoExpirada }: {
  api: Api;
  onSessaoExpirada: (status: number) => boolean | void;
}) {
  const [aberto, setAberto] = useState(false);
  const [categorias, setCategorias] = useState<CategoriaAdmin[]>([]);
  const [figurinhas, setFigurinhas] = useState<FigurinhaAdmin[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const [remover, setRemover] = useState<FigurinhaAdmin | null>(null);
  const [filtro, setFiltro] = useState<string>("todas");

  // Formulário de publicação (com pré-visualização antes de publicar).
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [ordem, setOrdem] = useState("");
  const [arquivo, setArquivo] = useState<{ base64: string; mime: string; tamanho: number } | null>(null);
  const [erroArquivo, setErroArquivo] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");

  // Nova categoria (para pacotes futuros, sem mudar o código do chat).
  const [novaCategoria, setNovaCategoria] = useState("");

  const arquivoInput = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await api<Resposta>("/api/admin/figurinhas");
    if (onSessaoExpirada(r.status)) return;
    if (r.ok) {
      setCategorias(r.dados.categorias ?? []);
      setFigurinhas(r.dados.figurinhas ?? []);
    }
  }, [api, onSessaoExpirada]);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  function escolherArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const input = evento.currentTarget;
    const f = input.files?.[0];
    input.value = "";
    setErroArquivo("");
    if (!f) return;
    if (f.size > TAMANHO_MAX) {
      setArquivo(null);
      setErroArquivo("A imagem precisa ter até 512 KB.");
      return;
    }
    if (!FORMATOS.split(",").includes(f.type)) {
      setArquivo(null);
      setErroArquivo("Envie uma imagem PNG, WebP ou GIF.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => {
      const url = String(leitor.result ?? "");
      const base64 = url.slice(url.indexOf(",") + 1);
      setArquivo({ base64, mime: f.type, tamanho: f.size });
      setNomeArquivo(f.name);
      if (!nome) setNome(f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60));
    };
    leitor.onerror = () => setErroArquivo("Não foi possível ler o arquivo.");
    leitor.readAsDataURL(f);
  }

  async function publicar() {
    if (ocupado) return;
    if (!arquivo) { setErroArquivo("Escolha uma imagem para a figurinha."); return; }
    if (nome.trim().length < 2) { setAviso({ texto: "Informe o nome da figurinha.", erro: true }); return; }
    if (!categoria) { setAviso({ texto: "Escolha a categoria da figurinha.", erro: true }); return; }
    setOcupado("publicar");
    try {
      const r = await api<Resposta>("/api/admin/figurinhas", {
        method: "POST",
        body: JSON.stringify({
          nome: nome.trim(),
          categoria,
          ordem: ordem ? Number(ordem) : undefined,
          arquivoBase64: arquivo.base64,
          mime: arquivo.mime,
        }),
      });
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok) { setAviso({ texto: r.dados.erro ?? "Não foi possível publicar.", erro: true }); return; }
      setNome(""); setOrdem(""); setArquivo(null); setNomeArquivo("");
      await carregar();
      setAviso({ texto: "Figurinha publicada! Já aparece para todos os motoristas.", erro: false });
    } catch {
      setAviso({ texto: "Sem conexão com o servidor.", erro: true });
    } finally {
      setOcupado(null);
    }
  }

  async function atualizar(f: FigurinhaAdmin, mudancas: { nome?: string; categoria?: string; ordem?: number; ativa?: boolean }) {
    if (ocupado) return;
    setOcupado(`fig-${f.id}`);
    try {
      const r = await api<Resposta>(`/api/admin/figurinhas/${f.id}`, { method: "PATCH", body: JSON.stringify(mudancas) });
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok) { setAviso({ texto: r.dados.erro ?? "Não foi possível atualizar.", erro: true }); return; }
      await carregar();
    } catch {
      setAviso({ texto: "Sem conexão com o servidor.", erro: true });
    } finally {
      setOcupado(null);
    }
  }

  async function mover(f: FigurinhaAdmin, direcao: -1 | 1) {
    const daCategoria = figurinhas
      .filter((x) => x.categoria === f.categoria)
      .sort((a, b) => a.ordem - b.ordem || a.id - b.id);
    const posicao = daCategoria.findIndex((x) => x.id === f.id);
    const outra = daCategoria[posicao + direcao];
    if (!outra) return;
    await Promise.all([
      atualizar(f, { ordem: outra.ordem }),
      atualizar(outra, { ordem: f.ordem }),
    ]);
  }

  async function confirmarRemocao() {
    if (!remover || ocupado) return;
    setOcupado(`del-${remover.id}`);
    try {
      const r = await api<{ erro?: string }>(`/api/admin/figurinhas/${remover.id}`, { method: "DELETE" });
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok) { setAviso({ texto: r.dados.erro ?? "Não foi possível excluir.", erro: true }); return; }
      setRemover(null);
      await carregar();
      setAviso({ texto: "Figurinha excluída do catálogo. As mensagens já enviadas continuam no chat.", erro: false });
    } catch {
      setAviso({ texto: "Sem conexão com o servidor.", erro: true });
    } finally {
      setOcupado(null);
    }
  }

  async function criarCategoria() {
    if (ocupado || !novaCategoria.trim()) return;
    setOcupado("categoria");
    try {
      const r = await api<Resposta>("/api/admin/figurinhas/categorias", {
        method: "POST",
        body: JSON.stringify({ nome: novaCategoria.trim(), ordem: categorias.length }),
      });
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok) { setAviso({ texto: r.dados.erro ?? "Não foi possível criar a categoria.", erro: true }); return; }
      setNovaCategoria("");
      await carregar();
      setAviso({ texto: "Categoria criada. Ela já aparece no seletor do chat.", erro: false });
    } catch {
      setAviso({ texto: "Sem conexão com o servidor.", erro: true });
    } finally {
      setOcupado(null);
    }
  }

  async function removerCategoria(chave: string, nome: string) {
    if (ocupado) return;
    if (!confirm(`Remover a categoria "${nome}"? Só funciona quando ela estiver vazia.`)) return;
    setOcupado(`cat-${chave}`);
    try {
      const r = await api<{ erro?: string }>(`/api/admin/figurinhas/categorias/${chave}`, { method: "DELETE" });
      if (onSessaoExpirada(r.status)) return;
      if (!r.ok) { setAviso({ texto: r.dados.erro ?? "Não foi possível remover.", erro: true }); return; }
      await carregar();
    } catch {
      setAviso({ texto: "Sem conexão com o servidor.", erro: true });
    } finally {
      setOcupado(null);
    }
  }

  const visiveis = filtro === "todas" ? figurinhas : figurinhas.filter((f) => f.categoria === filtro);
  const nomeCategoria = (chave: string) => categorias.find((c) => c.chave === chave)?.nome ?? chave;

  return (
    <section className="mt-4 rounded-[22px] border border-[#3342d0]/60 bg-[#02063d]/90 p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.03em] text-[#619bff] uppercase">
            <Sticker size={22} /> Figurinhas do chat
          </h2>
          <p className="mt-0.5 text-[12.5px] text-gelo/60">
            Publique, organize e desative as figurinhas que aparecem para todos os motoristas
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-gelo/70">
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 space-y-4 border-t border-[#3342d0]/35 pt-3">
          {/* ---------------------------- publicar figurinha nova */}
          <div className="rounded-[18px] border border-[#3342d0]/50 bg-[#01093d]/70 p-3.5">
            <h3 className="font-display text-[14px] font-extrabold text-white">Nova figurinha</h3>
            <p className="mt-0.5 text-[12px] text-gelo/55">PNG, WebP ou GIF (fundo transparente), até 512 KB. Veja a prévia antes de publicar.</p>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => arquivoInput.current?.click()}
                  className="grid h-[112px] w-[112px] place-items-center overflow-hidden rounded-[16px] border-[1.5px] border-dashed border-[#5376f4]/60 bg-[#020b50]/70 text-[#8dbaff] transition-colors hover:border-ciano/70"
                >
                  {arquivo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:${arquivo.mime};base64,${arquivo.base64}`} alt="Prévia da figurinha" className="h-full w-full object-contain p-1.5" />
                  ) : (
                    <ImagePlus size={26} />
                  )}
                </button>
                <button type="button" onClick={() => arquivoInput.current?.click()} className="text-[11.5px] font-bold text-ciano/90 hover:text-ciano">
                  {arquivo ? "Trocar imagem" : "Escolher imagem"}
                </button>
                {arquivo && <p className="max-w-[112px] truncate text-[10px] text-gelo/45">{nomeArquivo}</p>}
                {erroArquivo && <p role="alert" className="max-w-[140px] text-center text-[10.5px] text-amber-200/90">{erroArquivo}</p>}
                <input ref={arquivoInput} type="file" accept={FORMATOS} className="hidden" onChange={escolherArquivo} />
              </div>

              <div className="grid min-w-0 flex-1 gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-bold text-gelo/70">Nome</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value.slice(0, 60))}
                    placeholder="Ex.: Caminhão feliz"
                    className="w-full rounded-[13px] border-[1.5px] border-[#3342d0]/70 bg-[#02042b]/85 px-3 py-2 text-[14px] text-white outline-none placeholder:text-gelo/35 focus:border-ciano/70"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] font-bold text-gelo/70">Categoria</span>
                    <select
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value)}
                      className="w-full rounded-[13px] border-[1.5px] border-[#3342d0]/70 bg-[#02042b]/85 px-3 py-2 text-[14px] text-white outline-none focus:border-ciano/70"
                    >
                      <option value="">Escolha…</option>
                      {categorias.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] font-bold text-gelo/70">Ordem</span>
                    <input
                      value={ordem}
                      onChange={(e) => setOrdem(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      placeholder="0"
                      className="w-full rounded-[13px] border-[1.5px] border-[#3342d0]/70 bg-[#02042b]/85 px-3 py-2 text-[14px] text-white outline-none placeholder:text-gelo/35 focus:border-ciano/70"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void publicar()}
                  disabled={ocupado !== null}
                  className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#5376f4] px-5 font-display text-[14px] font-extrabold text-white uppercase shadow-[0_8px_24px_-12px_rgba(83,118,244,.9)] transition-transform hover:scale-[1.01] active:scale-95 disabled:opacity-50"
                >
                  {ocupado === "publicar" ? <LoaderCircle size={17} className="animate-spin" /> : <Plus size={17} />}
                  Publicar figurinha
                </button>
              </div>
            </div>
          </div>

          {/* -------------------------------------- categorias/pacotes */}
          <div className="rounded-[18px] border border-[#3342d0]/50 bg-[#01093d]/70 p-3.5">
            <h3 className="font-display text-[14px] font-extrabold text-white">Categorias</h3>
            <p className="mt-0.5 text-[12px] text-gelo/55">Categorias novas viram pacotes no seletor do chat, sem alterar código.</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {categorias.map((c) => (
                <span key={c.chave} className="inline-flex items-center gap-1.5 rounded-full border border-[#3342d0]/60 bg-[#020b50]/70 px-2.5 py-1.5 text-[12px] font-bold text-gelo/85">
                  {c.nome}
                  <button type="button" onClick={() => void removerCategoria(c.chave, c.nome)} aria-label={`Remover categoria ${c.nome}`} className="text-gelo/45 transition-colors hover:text-red-300">
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value.slice(0, 40))}
                placeholder="Nome da categoria nova"
                className="min-w-0 flex-1 rounded-[13px] border-[1.5px] border-[#3342d0]/70 bg-[#02042b]/85 px-3 py-2 text-[13.5px] text-white outline-none placeholder:text-gelo/35 focus:border-ciano/70"
              />
              <button
                type="button"
                onClick={() => void criarCategoria()}
                disabled={ocupado !== null || !novaCategoria.trim()}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-ciano/50 px-4 text-[12.5px] font-bold text-ciano transition-colors hover:bg-ciano/10 disabled:opacity-45"
              >
                {ocupado === "categoria" ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
                Criar
              </button>
            </div>
          </div>

          {/* --------------------------------------- biblioteca atual */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[14px] font-extrabold text-white">
                Biblioteca <span className="text-gelo/50">({visiveis.length})</span>
              </h3>
              <select
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                aria-label="Filtrar por categoria"
                className="rounded-full border border-[#3342d0]/60 bg-[#020b50]/70 px-3 py-1.5 text-[12px] font-bold text-gelo/85 outline-none"
              >
                <option value="todas">Todas as categorias</option>
                {categorias.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
              </select>
            </div>

            {visiveis.length === 0 ? (
              <p className="mt-3 rounded-[14px] border border-dashed border-[#3342d0]/50 py-6 text-center text-[12.5px] text-gelo/50">
                Nenhuma figurinha publicada ainda.
              </p>
            ) : (
              <ul className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {visiveis.map((f) => (
                  <li key={f.id} className={`rounded-[16px] border p-2.5 ${f.ativa ? "border-[#3342d0]/55 bg-[#01093d]/70" : "border-white/10 bg-white/[.03] opacity-70"}`}>
                    <div className="relative grid aspect-square place-items-center overflow-hidden rounded-[12px] border border-white/10 bg-[radial-gradient(circle_at_50%_35%,rgba(83,118,244,.16),rgba(1,9,61,.9))]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.imagemUrl} alt="" className="h-full w-full object-contain p-2" />
                      {!f.ativa && (
                        <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-amber-200">Desativada</span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-[12.5px] font-extrabold text-white" title={f.nome}>{f.nome}</p>
                    <p className="text-[10.5px] text-gelo/55">{nomeCategoria(f.categoria)} · #{f.id}</p>

                    <div className="mt-2 flex items-center gap-1">
                      <button type="button" onClick={() => void mover(f, -1)} disabled={ocupado !== null} aria-label="Subir na ordem" className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-gelo/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => void mover(f, 1)} disabled={ocupado !== null} aria-label="Descer na ordem" className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-gelo/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"><ArrowDown size={14} /></button>
                      <button
                        type="button"
                        onClick={() => void atualizar(f, { ativa: !f.ativa })}
                        disabled={ocupado !== null}
                        aria-label={f.ativa ? "Desativar figurinha" : "Ativar figurinha"}
                        title={f.ativa ? "Desativar (some do seletor)" : "Ativar (volta para o seletor)"}
                        className={`grid h-8 w-8 place-items-center rounded-full border transition-colors disabled:opacity-40 ${f.ativa ? "border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10" : "border-white/10 text-gelo/60 hover:bg-white/10"}`}
                      >
                        {f.ativa ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemover(f)}
                        aria-label="Excluir figurinha"
                        title="Excluir do catálogo"
                        className="grid h-8 w-8 place-items-center rounded-full border border-red-400/30 text-red-300/90 transition-colors hover:bg-red-400/10"
                      >
                        <Trash2 size={14} />
                      </button>
                      {ocupado === `fig-${f.id}` && <LoaderCircle size={14} className="animate-spin text-ciano" />}
                    </div>

                    <label className="mt-2 block">
                      <span className="sr-only">Categoria da figurinha {f.nome}</span>
                      <select
                        value={f.categoria}
                        onChange={(e) => void atualizar(f, { categoria: e.target.value })}
                        disabled={ocupado !== null}
                        className="w-full rounded-[10px] border border-white/10 bg-[#02042b]/85 px-2 py-1.5 text-[11px] font-bold text-gelo/85 outline-none disabled:opacity-45"
                      >
                        {categorias.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* confirmação de exclusão */}
      {remover && (
        <div role="alertdialog" aria-modal="true" aria-label="Excluir figurinha" className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-[420px] rounded-[22px] border border-red-500/50 bg-[linear-gradient(180deg,#1a1030,#0d0a22)] p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-red-500/15 text-red-400"><Trash2 size={22} /></span>
              <button type="button" onClick={() => setRemover(null)} aria-label="Fechar" className="text-gelo/60 hover:text-white"><X size={20} /></button>
            </div>
            <h3 className="mt-3 font-display text-[17px] leading-snug font-extrabold text-white">Excluir “{remover.nome}”?</h3>
            <p className="mt-1.5 text-[13px] text-gelo/80">
              Ela some do seletor de todos os motoristas. As mensagens já enviadas continuam no chat — cada mensagem guarda a própria cópia.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setRemover(null)} className="rounded-full border-[1.5px] border-[#3342d0]/70 py-2.5 font-display text-[14px] font-bold text-white uppercase hover:bg-white/5">Cancelar</button>
              <button type="button" onClick={() => void confirmarRemocao()} disabled={ocupado !== null} className="rounded-full bg-red-500 py-2.5 font-display text-[14px] font-extrabold text-white uppercase hover:bg-red-600 disabled:opacity-50">
                {ocupado === `del-${remover.id}` ? <LoaderCircle size={16} className="mx-auto animate-spin" /> : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {aviso && (
        <div role="status" className={`mt-3 rounded-[14px] border px-3.5 py-2.5 text-[12.5px] font-semibold ${aviso.erro ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-emerald-300/40 bg-emerald-300/10 text-emerald-100"}`}>
          {aviso.texto}
        </div>
      )}
    </section>
  );
}
