import React from 'react';
// Name-keyed wrapper over the real, already-SSR-safe icon set in
// components/icons.jsx — the design-tool export's `_ds_bundle.js` shipped
// its own compiled `Icon({ name })` component for the same purpose (see
// _ds/.../README.md's "Intentional additions"), but every glyph it draws
// already exists there, so this just maps the export's string names onto
// the real components instead of hand-porting a duplicate icon set.
import {
  IconShield, IconLayers, IconPackage, IconTruck, IconMapPin, IconCompass,
  IconFile, IconStar, IconClock, IconCheck, IconInfo, IconGavel, IconWallet,
  IconStorefront, IconRuler, IconAcUnit, IconBoat, IconWarehouse,
  IconInventory, IconUser, IconArrowRight, IconTrailer,
} from '../icons.jsx';

const MAP = {
  Shield: IconShield,
  Layers: IconLayers,
  Package: IconPackage,
  Truck: IconTruck,
  MapPin: IconMapPin,
  Compass: IconCompass,
  File: IconFile,
  Star: IconStar,
  Clock: IconClock,
  Check: IconCheck,
  Info: IconInfo,
  Gavel: IconGavel,
  Wallet: IconWallet,
  Storefront: IconStorefront,
  Ruler: IconRuler,
  AcUnit: IconAcUnit,
  Boat: IconBoat,
  Warehouse: IconWarehouse,
  Inventory: IconInventory,
  User: IconUser,
  ArrowRight: IconArrowRight,
  Trailer: IconTrailer,
};

export function MktIcon({ name, size = 18, ...rest }) {
  const Cmp = MAP[name];
  if (!Cmp) return null;
  return <Cmp size={size} {...rest} />;
}
