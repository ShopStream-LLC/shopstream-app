declare module "*.css";

// Allow Shopify admin navigation web component used by Shopify CLI templates.
// This is a typing-only declaration so TSX doesn't error on <ui-nav-menu>.
declare namespace JSX {
  interface IntrinsicElements {
    "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
  }
}