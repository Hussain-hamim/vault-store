/// <reference types="vite/client" />
declare module "*.woff2?inline" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}
