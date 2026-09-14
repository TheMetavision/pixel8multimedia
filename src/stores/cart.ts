import { atom, computed } from 'nanostores';
import { persistentAtom } from '@nanostores/persistent';
import type { ProductFormat, ProductSize } from '../data/products';
import { PRICES } from '../data/products';

export interface CartItem {
  id: string;
  productId: string;
  slug: string;
  title: string;
  collection: string; // now stores category value
  format: ProductFormat;
  size: ProductSize;
  quantity: number;
  unitPrice: number;
  accentColor: string;
  imageUrl?: string;
  // "Your Photo" lines only — see src/pages/store/your-photo.astro
  personalisationId?: string;  // pendingPersonalisation.pid
  styleKey?: string;           // style-a … style-h
  personalisationFee?: number; // already folded into unitPrice; kept for display
}

// Persistent cart — survives page navigation via localStorage.
// Key 'pixel8-cart-v1' is brand-scoped so it can't collide with other sites
// on the same domain (e.g. preview deploys) or other tabs.
export const cartItems = persistentAtom<CartItem[]>('pixel8-cart-v1', [], {
  encode: JSON.stringify,
  decode: JSON.parse,
});

// Drawer open/closed is UI state, not persisted.
export const cartOpen = atom<boolean>(false);

export const cartCount = computed(cartItems, (items) =>
  items.reduce((sum, item) => sum + item.quantity, 0)
);

export const cartTotal = computed(cartItems, (items) =>
  items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
);

export function addToCart(item: Omit<CartItem, 'id'>) {
  const current = cartItems.get();
  // Personalised lines match on the personalisation id as well as format and
  // size: two different photos share a productId but are different products,
  // while the same design ordered twice in the same size is quantity 2.
  const existing = current.find(
    (i) =>
      i.personalisationId === item.personalisationId &&
      i.productId === item.productId &&
      i.format === item.format &&
      i.size === item.size
  );
  if (existing) {
    cartItems.set(
      current.map((i) =>
        i.id === existing.id ? { ...i, quantity: i.quantity + item.quantity } : i
      )
    );
  } else {
    const stem = item.personalisationId ?? item.productId;
    cartItems.set([...current, { ...item, id: `${stem}-${item.format}-${item.size}-${Date.now()}` }]);
  }
  cartOpen.set(true);
}

export function removeFromCart(id: string) {
  cartItems.set(cartItems.get().filter((i) => i.id !== id));
}

export function updateQuantity(id: string, quantity: number) {
  if (quantity < 1) {
    removeFromCart(id);
    return;
  }
  cartItems.set(cartItems.get().map((i) => (i.id === id ? { ...i, quantity } : i)));
}

export function clearCart() {
  cartItems.set([]);
}

export function getPriceForFormatSize(format: ProductFormat, size: ProductSize): number {
  return PRICES[format][size];
}
