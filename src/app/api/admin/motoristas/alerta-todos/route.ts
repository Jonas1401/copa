/**
 * Atalho para /api/admin/motoristas/alertar-todos — as duas grafias já estavam
 * publicadas, então as duas continuam valendo, mas com UM tratador só (antes
 * cada uma tinha uma cópia do mesmo código).
 */
export { POST } from "../alertar-todos/route";

export const dynamic = "force-dynamic";
