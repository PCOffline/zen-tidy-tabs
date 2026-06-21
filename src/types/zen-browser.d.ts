/** Ambient type declarations for Firefox/Zen Browser chrome globals. */

// ----- Mozilla Services -----

interface MozPrefs {
  getStringPref(name: string, fallback?: string): string;
  setStringPref(name: string, value: string): void;
}

interface MozWindowMediator {
  getMostRecentWindow(type: string): ChromeWindow | null;
}

interface MozServices {
  prefs: MozPrefs;
  wm: MozWindowMediator;
}

declare const Services: MozServices;
declare const ChromeUtils: unknown;

// ----- Tabs & Tab Groups -----

interface ZenTab extends HTMLElement {
  pinned: boolean;
  hidden: boolean;
  closing: boolean;
  group: ZenTabGroup | null;
  label: string;
  linkedBrowser: { currentURI: { spec: string } } | null;
  isConnected: boolean;
}

interface ZenTabGroup extends HTMLElement {
  label: string;
  color: string;
  tabs: ZenTab[] | NodeListOf<ZenTab>;
  addTabs(tabs: ZenTab[]): void;
}

// ----- Notification Box -----

type ZenNotification = object;

interface ZenNotificationBox {
  PRIORITY_WARNING_HIGH: number;
  PRIORITY_INFO_LOW: number;
  appendNotification(
    value: string,
    options: { label: string; priority: number },
    buttons: unknown[],
  ): ZenNotification | Promise<ZenNotification | null>;
  removeNotification(note: ZenNotification): void;
}

// ----- Tab Group Menu -----

interface ZenTabGroupMenu {
  openEditModal(group: ZenTabGroup): void;
  close(): void;
  panel: HTMLElement | null;
  activeGroup: ZenTabGroup | null;
}

// ----- gBrowser -----

interface ZenBrowser {
  tabs: ZenTab[];
  selectedTab: ZenTab;
  addTabGroup(
    tabs: ZenTab[],
    options?: {
      label?: string;
      color?: string;
      insertBefore?: ZenTab;
      isUserTriggered?: boolean;
    },
  ): ZenTabGroup | null;
  removeTabGroup(group: ZenTabGroup): void;
  ungroupTab(tab: ZenTab): void;
  getNotificationBox(): ZenNotificationBox;
  addTrustedTab(url: string): ZenTab;
  tabGroupMenu: ZenTabGroupMenu | null;
}

declare const gBrowser: ZenBrowser;

// ----- Zen Workspaces -----

interface ZenWorkspaces {
  activeWorkspace: string | null;
  activeWorkspaceElement: HTMLElement | null;
  addChangeListeners(listener: () => void, options?: { once?: boolean }): void;
  removeChangeListeners(listener: () => void): void;
}

declare const gZenWorkspaces: ZenWorkspaces | undefined;

// ----- Window extensions -----

interface ZenTidyTabsAPI {
  run(): Promise<void>;
  settings(): void;
  mount(): boolean;
  diagnose(): void;
  injectStyles(): void;
  collect(grouped?: boolean): ZenTab[];
}

interface Window {
  gBrowser: ZenBrowser;
  gZenWorkspaces?: ZenWorkspaces;
  zenTidyTabs?: ZenTidyTabsAPI;
  openTrustedLinkIn?(url: string, where: string): void;

  __zenTidyTabsMountRetryTimer: ReturnType<typeof setInterval> | null;
  __zenTidyTabsEmptyWatcher: MutationObserver | null;
  __zenTidyTabsClearWatcher: {
    token: object;
    target: HTMLElement;
    handler: () => void;
  } | null;
  __zenTidyTabsWorkspaceWatcher: {
    token: object;
    listener: () => void;
  } | null;
  __zenTidyTabsEditorListeners: {
    onClick: (e: MouseEvent) => void;
    onContextMenu: (e: MouseEvent) => void;
  } | null;
  __zenTidyTabsPanelOverride: {
    panel: HTMLElement;
    onCommand: (e: Event) => void;
  } | null;
}

type ChromeWindow = Window & typeof globalThis;
