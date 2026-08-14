// Small hand-rolled inline icon set — matches the documented convention
// (lucide-react is the aspirational convention but isn't installed; plain
// inline SVGs are used instead). Minimal, single-stroke, 20x20 default.
import React from 'react';

function Icon({ children, size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const IconMenu = (p) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Icon>;
export const IconClose = (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const IconBell = (p) => <Icon {...p}><path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 12 6 8Z" /><path d="M9.5 17a2.5 2.5 0 0 0 5 0" /></Icon>;
export const IconChevronDown = (p) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const IconChevronRight = (p) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const IconArrowRight = (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const IconArrowLeft = (p) => <Icon {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></Icon>;
export const IconLogOut = (p) => <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Icon>;
export const IconCheck = (p) => <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>;
export const IconPackage = (p) => <Icon {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></Icon>;
export const IconTruck = (p) => <Icon {...p}><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" /></Icon>;
export const IconShield = (p) => <Icon {...p}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /></Icon>;
export const IconClock = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Icon>;
export const IconMapPin = (p) => <Icon {...p}><path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.7" /></Icon>;
export const IconFile = (p) => <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>;
export const IconStar = (p) => <Icon {...p}><path d="m12 3 2.6 5.9 6.4.6-4.9 4.2 1.5 6.3L12 16.9 6.4 20l1.5-6.3-4.9-4.2 6.4-.6L12 3Z" /></Icon>;
export const IconSettings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.6.7 1 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z" /></Icon>;
export const IconPlus = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const IconSearch = (p) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Icon>;
export const IconUser = (p) => <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></Icon>;
export const IconAlert = (p) => <Icon {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.5 18a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0Z" /></Icon>;
export const IconSun = (p) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
export const IconMoon = (p) => <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" /></Icon>;
export const IconMessage = (p) => <Icon {...p}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></Icon>;
export const IconTag = (p) => <Icon {...p}><path d="M12.6 2H4a2 2 0 0 0-2 2v8.6a2 2 0 0 0 .6 1.4l9 9a2 2 0 0 0 2.8 0l8-8a2 2 0 0 0 0-2.8l-9-9a2 2 0 0 0-1.4-.6Z" /><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" /></Icon>;
export const IconTrailer = (p) => <Icon {...p}><path d="M2 8h13v8H2z" /><path d="M15 12h4l3 2v2h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="18.5" cy="18" r="1.6" /><path d="M2 8V6h9v2" /></Icon>;
export const IconLayers = (p) => <Icon {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></Icon>;
export const IconCompass = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m15 9-2 6-6 2 2-6 6-2Z" /></Icon>;
export const IconInfo = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>;
export const IconX = (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const IconDownload = (p) => <Icon {...p}><path d="M12 3v12m0 0-4-4m4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Icon>;
export const IconUpload = (p) => <Icon {...p}><path d="M12 21V9m0 0-4 4m4-4 4 4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Icon>;
export const IconSparkle = (p) => <Icon {...p}><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></Icon>;

// ---------------------------------------------------------------------
// Batch added for the Industrial Trust redesign — hand-rolled equivalents
// of the Material Symbols glyphs the Stitch mockups use, following the
// same minimal single-stroke 24px convention as the set above (see the
// design-foundation decision in the redesign plan: redraw, don't add a
// font-icon library).
export const IconHome = (p) => <Icon {...p}><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></Icon>;
export const IconGrid = (p) => <Icon {...p}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></Icon>;
export const IconFilter = (p) => <Icon {...p}><path d="M4 5h16M7 12h10M10 19h4" /></Icon>;
export const IconSort = (p) => <Icon {...p}><path d="M7 4v16m0-16-3.5 3.5M7 4l3.5 3.5" /><path d="M17 20V4m0 16 3.5-3.5M17 20l-3.5-3.5" /></Icon>;
export const IconTune = (p) => <Icon {...p}><path d="M4 6h9M17 6h3M4 18h3M11 18h9" /><circle cx="14" cy="6" r="2.2" /><circle cx="7" cy="18" r="2.2" /></Icon>;
export const IconCamera = (p) => <Icon {...p}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13.5" r="3.5" /></Icon>;
export const IconCalendar = (p) => <Icon {...p}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>;
export const IconPhone = (p) => <Icon {...p}><path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2C10.5 19.5 4.5 13.5 4.5 5a2 2 0 0 1 2-2Z" /></Icon>;
export const IconLayoutGrid = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="14" y="3" width="7" height="8" rx="1.5" /><rect x="14" y="15" width="7" height="6" rx="1.5" /></Icon>;
export const IconChat = (p) => <Icon {...p}><path d="M4 5h16v10H9l-4 4V5Z" /><path d="M8 9h8M8 12h5" /></Icon>;
export const IconCheckCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.3 2.3 4.7-5" /></Icon>;
export const IconEdit = (p) => <Icon {...p}><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M13.5 7.5l3 3" /></Icon>;
export const IconExplore = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></Icon>;
export const IconFlag = (p) => <Icon {...p}><path d="M5 21V4" /><path d="M5 5c2-1.3 4-1.3 6 0s4 1.3 6 0v8c-2 1.3-4 1.3-6 0s-4-1.3-6 0Z" /></Icon>;
export const IconGavel = (p) => <Icon {...p}><path d="m8 4 5 5-8 8-5-5Z" /><path d="m13 9 6.5-6.5 3 3L16 12" /><path d="M3 21h9" /></Icon>;
export const IconGroup = (p) => <Icon {...p}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3.5 20c.7-3.4 3-5.5 5.5-5.5s4.8 2.1 5.5 5.5" /><path d="M15.5 15c1.9.2 3.4 1.9 4 4.5" /></Icon>;
export const IconHandshake = (p) => <Icon {...p}><path d="M2 12h4l3-3 3 3 3-3 3 3h4" /><path d="m8 12 3 3.5a1.6 1.6 0 0 0 2.4 0L16 12" /><path d="M9 15.5 7.5 17a1.4 1.4 0 0 0 2 2L11 17.5" /></Icon>;
export const IconHelp = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.2 1-1.2 2" /><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" /></Icon>;
export const IconHistory = (p) => <Icon {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2" /><path d="M6 4 4 6M4 6l.5 3M4 6l3-.5" /></Icon>;
export const IconInventory = (p) => <Icon {...p}><rect x="3" y="7" width="18" height="13" rx="1.5" /><path d="M3 11h18" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></Icon>;
export const IconLock = (p) => <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const IconMail = (p) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6 8.5 7 8.5-7" /></Icon>;
export const IconMic = (p) => <Icon {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v4M9 21h6" /></Icon>;
export const IconMore = (p) => <Icon {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></Icon>;
export const IconMoreVertical = (p) => <Icon {...p}><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></Icon>;
export const IconPayments = (p) => <Icon {...p}><rect x="2.5" y="6" width="15" height="11" rx="2" /><rect x="6.5" y="9.5" width="15" height="11" rx="2" fill="var(--bg-surface,#fff)" /><path d="M11 15h6" /></Icon>;
export const IconPending = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
export const IconPdf = (p) => <Icon {...p}><path d="M7 3h7l4 4v14H7Z" /><path d="M14 3v4h4" /><path d="M9.5 13v5M9.5 13h1.3a1.3 1.3 0 0 1 0 2.6H9.5M13.5 18v-5h2M13.5 15.5h1.7" /></Icon>;
export const IconReceipt = (p) => <Icon {...p}><path d="M6 3h12v18l-2-1.3L14 21l-2-1.3L10 21l-2-1.3L6 21Z" /><path d="M9 8h6M9 12h6M9 16h4" /></Icon>;
export const IconRemove = (p) => <Icon {...p}><path d="M5 12h14" /></Icon>;
export const IconReport = (p) => <Icon {...p}><path d="M12 3 3 20h18Z" /><path d="M12 10v4M12 16.5h.01" /></Icon>;
export const IconRuler = (p) => <Icon {...p}><rect x="3" y="9" width="18" height="6" rx="1.5" /><path d="M7 9v3M11 9v3M15 9v3" /></Icon>;
export const IconSatellite = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M4.5 4.5 9 9M19.5 19.5 15 15M4.5 19.5 9 15M19.5 4.5 15 9" /></Icon>;
export const IconSchedule = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Icon>;
export const IconSend = (p) => <Icon {...p}><path d="M4 4v6l11 2-11 2v6l17-10Z" /></Icon>;
export const IconSensors = (p) => <Icon {...p}><circle cx="12" cy="12" r="2.2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" /><path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" /></Icon>;
export const IconSms = (p) => <Icon {...p}><path d="M4 5h16v10H10l-4.5 3.5V15H4Z" /><path d="M8 9h.01M12 9h.01M16 9h.01" /></Icon>;
export const IconSpeed = (p) => <Icon {...p}><circle cx="12" cy="13" r="8" /><path d="M12 13 16 9" /><path d="M8 5.5 6.5 4M16 5.5 17.5 4" /></Icon>;
export const IconStorefront = (p) => <Icon {...p}><path d="M4 9V5h16v4" /><path d="M3 9h18l-1 3a2.3 2.3 0 0 1-4.3 1 2.3 2.3 0 0 1-4.4 0 2.3 2.3 0 0 1-4.4 0A2.3 2.3 0 0 1 4 12Z" /><path d="M5 12.5V20h14v-7.5" /></Icon>;
export const IconSync = (p) => <Icon {...p}><path d="M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2" /><path d="M17.5 4v3.5H14M6.5 20v-3.5H10" /></Icon>;
export const IconTimer = (p) => <Icon {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></Icon>;
export const IconTrendUp = (p) => <Icon {...p}><path d="m3 16 6-6 4 4 8-8" /><path d="M15 6h6v6" /></Icon>;
export const IconTrendDown = (p) => <Icon {...p}><path d="m3 8 6 6 4-4 8 8" /><path d="M15 18h6v-6" /></Icon>;
export const IconVisibility = (p) => <Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></Icon>;
export const IconWarehouse = (p) => <Icon {...p}><path d="M3 10 12 4l9 6v10H3Z" /><path d="M9 20v-6h6v6" /></Icon>;
export const IconZoomIn = (p) => <Icon {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.35-4.35M10.5 8v5M8 10.5h5" /></Icon>;
export const IconAccountCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6 18.5c1.3-2.4 3.4-3.5 6-3.5s4.7 1.1 6 3.5" /></Icon>;
export const IconBank = (p) => <Icon {...p}><path d="m4 9 8-5 8 5" /><path d="M4 9h16v2H4z" /><path d="M6 11v7M10.5 11v7M13.5 11v7M18 11v7" /><path d="M3.5 20h17" /></Icon>;
export const IconWallet = (p) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16" cy="13.5" r="1.4" fill="currentColor" stroke="none" /></Icon>;
export const IconInsertChart = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 16v-4M12 16V8M16 16v-7" /></Icon>;
export const IconDonut = (p) => <Icon {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /><path d="M12 4a8 8 0 0 1 6.9 4" /></Icon>;
export const IconFlashAuto = (p) => <Icon {...p}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></Icon>;
export const IconAsterisk = (p) => <Icon {...p}><path d="M12 4v16M6 7l12 10M18 7 6 17" /></Icon>;
export const IconArrowDown = (p) => <Icon {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Icon>;
export const IconBoat = (p) => <Icon {...p}><path d="M4 14h16l-2 5H6Z" /><path d="M7 14V7h7l3 7" /><path d="M10 7V3h1v4" /></Icon>;
export const IconBusFront = (p) => <Icon {...p}><rect x="4" y="4" width="16" height="13" rx="2" /><path d="M4 10h16" /><circle cx="8" cy="20" r="1.6" /><circle cx="16" cy="20" r="1.6" /></Icon>;
export const IconRvHookup = (p) => <Icon {...p}><path d="M3 15h11V8H8L3 12Z" /><path d="M14 10h4l3 3v2h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="18.5" cy="18" r="1.6" /><path d="M22 13.5h-1.5" /></Icon>;
export const IconAcUnit = (p) => <Icon {...p}><path d="M12 2v20M4 6l16 12M20 6 4 18" /></Icon>;
