/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default room-server address, baked in at build time. Optional. */
  readonly VITE_GENESYS_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
