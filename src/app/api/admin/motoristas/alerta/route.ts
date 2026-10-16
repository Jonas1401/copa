/**
 * Atalho para /api/admin/motoristas/alertar-todos (grafia antiga, sem o
 * "-todos"): alerta para TODOS os motoristas sem notificações ativas.
 * O alerta de UM motorista é /api/admin/motoristas/[id]/alerta.
 */
export { POST } from "../alertar-todos/route";

export const dynamic = "force-dynamic";
