/**
 * Renders category icons. Keys come from the shared safe registry
 * (`@likehoney/shared` — curated grid + the larger registry-only set), and
 * every key maps to a Lucide component that exists in the pinned
 * `lucide-react`. The map-completeness test in `category-icons.test.ts` pins
 * "every registry key resolves here" so a live category never renders an empty
 * tile. Never add a key to `CATEGORY_ICON_REGISTRY` without adding its
 * component in this exact map.
 */
import {
  Armchair,
  Award,
  Baby,
  Backpack,
  Balloon,
  Banknote,
  Bed,
  Bell,
  Bike,
  Bird,
  Blocks,
  Book,
  BookOpen,
  Box,
  Brush,
  Bus,
  Calculator,
  Calendar,
  Camera,
  Car,
  CarFront,
  Castle,
  Cat,
  Clock,
  Cloud,
  CloudSun,
  Coins,
  Compass,
  CreditCard,
  Crown,
  Diamond,
  Dices,
  Dog,
  Drum,
  Dumbbell,
  Eraser,
  Flower,
  Flower2,
  Gamepad,
  Gem,
  Gift,
  Glasses,
  Globe,
  Goal,
  GraduationCap,
  Guitar,
  Handbag,
  Headphones,
  Heart,
  HeartHandshake,
  House,
  Key,
  Lamp,
  LampDesk,
  Leaf,
  Library,
  Lock,
  Map,
  Medal,
  Mic,
  Moon,
  Music,
  Music2,
  NotebookPen,
  Package,
  PaintBucket,
  Paintbrush,
  Palette,
  Paperclip,
  PartyPopper,
  Pencil,
  Piano,
  Plane,
  Puzzle,
  Rabbit,
  Rainbow,
  Rocket,
  Ruler,
  School,
  ShieldCheck,
  Ship,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  SportShoe,
  Sprout,
  Star,
  Store,
  Sun,
  Tag,
  Tags,
  Timer,
  ToyBrick,
  TrainFront,
  Trophy,
  Truck,
  Turtle,
  Users,
  UserRound,
  Video,
  Volleyball,
  Wallet,
  Wand,
  Watch,
  type LucideIcon,
} from 'lucide-react'
import type { CategoryVisualMode } from '@likehoney/shared'

/** Every safe-registry key mapped to its verified Lucide component. */
export const CATEGORY_ICON_COMPONENTS: Record<string, LucideIcon> = {
  // Curated grid
  shirt: Shirt,
  'sport-shoe': SportShoe,
  gift: Gift,
  backpack: Backpack,
  baby: Baby,
  'toy-brick': ToyBrick,
  balloon: Balloon,
  puzzle: Puzzle,
  'graduation-cap': GraduationCap,
  school: School,
  package: Package,
  star: Star,
  heart: Heart,
  sparkles: Sparkles,
  wand: Wand,
  rainbow: Rainbow,
  crown: Crown,
  music: Music,
  // Shopping / retail
  'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart,
  'shopping-basket': ShoppingBasket,
  store: Store,
  tag: Tag,
  tags: Tags,
  wallet: Wallet,
  'credit-card': CreditCard,
  banknote: Banknote,
  coins: Coins,
  box: Box,
  // Clothing & accessories
  watch: Watch,
  glasses: Glasses,
  handbag: Handbag,
  // Kids & play
  blocks: Blocks,
  dice: Dices,
  rocket: Rocket,
  gamepad: Gamepad,
  'party-popper': PartyPopper,
  castle: Castle,
  // Transport
  car: Car,
  'car-front': CarFront,
  bus: Bus,
  bike: Bike,
  truck: Truck,
  'train-front': TrainFront,
  plane: Plane,
  ship: Ship,
  // School & stationery
  book: Book,
  'book-open': BookOpen,
  'notebook-pen': NotebookPen,
  pencil: Pencil,
  ruler: Ruler,
  eraser: Eraser,
  calculator: Calculator,
  compass: Compass,
  globe: Globe,
  map: Map,
  library: Library,
  paperclip: Paperclip,
  key: Key,
  lock: Lock,
  // Art & creative
  palette: Palette,
  brush: Brush,
  paintbrush: Paintbrush,
  'paint-bucket': PaintBucket,
  // Home & nature
  house: House,
  sofa: Sofa,
  armchair: Armchair,
  lamp: Lamp,
  'lamp-desk': LampDesk,
  bed: Bed,
  leaf: Leaf,
  sprout: Sprout,
  flower: Flower,
  'flower-2': Flower2,
  sun: Sun,
  moon: Moon,
  cloud: Cloud,
  'cloud-sun': CloudSun,
  // Animals
  cat: Cat,
  dog: Dog,
  rabbit: Rabbit,
  bird: Bird,
  turtle: Turtle,
  // Awards & celebration
  award: Award,
  trophy: Trophy,
  medal: Medal,
  gem: Gem,
  diamond: Diamond,
  // Music, media & tech
  'music-2': Music2,
  headphones: Headphones,
  guitar: Guitar,
  piano: Piano,
  drum: Drum,
  mic: Mic,
  camera: Camera,
  video: Video,
  smartphone: Smartphone,
  // Sports
  volleyball: Volleyball,
  dumbbell: Dumbbell,
  goal: Goal,
  // General lifestyle
  'heart-handshake': HeartHandshake,
  'shield-check': ShieldCheck,
  bell: Bell,
  calendar: Calendar,
  clock: Clock,
  timer: Timer,
  users: Users,
  'user-round': UserRound,
}

/**
 * Resolve an icon key to its renderable component (undefined = not registered).
 */
export function categoryIconComponent(key: string | null | undefined): LucideIcon | undefined {
  if (key === null || key === undefined) return undefined
  return CATEGORY_ICON_COMPONENTS[key]
}

export type CategoryVisual = 'image' | 'icon' | 'auto'

/**
 * Storefront visual priority for a category tile, honoring the persisted
 * display mode:
 *  - `auto` / `image`: image → icon → automatic fallback;
 *  - `icon`: icon (when a renderable key exists) → automatic fallback.
 * The image may stay stored while `icon` mode is active — mode switching is
 * never destructive. `'icon'` is returned only for a key that actually
 * resolves to a component, so a live category never renders an empty tile.
 */
export function resolveCategoryVisual(category: {
  imageUrl: string | null
  iconKey: string | null
  visualMode?: CategoryVisualMode
}): CategoryVisual {
  const mode = category.visualMode ?? 'auto'
  if (mode === 'icon') {
    if (category.iconKey !== null && categoryIconComponent(category.iconKey) !== undefined) {
      return 'icon'
    }
    return 'auto'
  }
  if (category.imageUrl !== null) return 'image'
  if (category.iconKey !== null && categoryIconComponent(category.iconKey) !== undefined) {
    return 'icon'
  }
  return 'auto'
}
