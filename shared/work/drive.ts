/* Private Drive key-file format shared by browser vaults and cloud recovery. */
import type { Owner_Wrap } from "./crypto.ts"
export type Client_Key = { room: string, key: string, owner_wrap: Owner_Wrap, key_id: string }
export type Key_Vault = { v: 2, owner?: { private_jwk: JsonWebKey, public_jwk: JsonWebKey }, client?: Client_Key }
