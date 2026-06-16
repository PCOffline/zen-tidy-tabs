// Ambient declarations for the Firefox/Zen *chrome-context* globals that the
// functions injected by `ZenDriver.exec` reference. These run inside Zen's
// privileged chrome window (Marionette CHROME context), not a normal web page,
// so they aren't covered by TypeScript's "DOM" lib. Types here are intentionally
// minimal -- only the surface the test harness actually touches.

export {};

declare global {
  /** A Firefox/Zen `<tab>` element (the `.tabbrowser-tab` in the strip). */
  interface MozTab extends Element {
    pinned: boolean;
    group: MozTabGroup | null;
  }

  /** A Firefox/Zen `<tab-group>` custom element. */
  interface MozTabGroup extends Element {
    label: string;
    color: string;
    /** Live tabs in the group; absent on some builds (fall back to a query). */
    tabs?: MozTab[];
  }

  interface AddTabGroupOptions {
    label?: string;
    color?: string;
    insertBefore?: MozTab;
  }

  /** The subset of Zen's global `gBrowser` the harness drives. */
  interface GBrowser {
    tabs: MozTab[];
    selectedTab: MozTab;
    addTrustedTab(url: string): MozTab;
    addTab(url: string, opts: { triggeringPrincipal: unknown }): MozTab;
    removeTab(tab: MozTab, opts?: { animate?: boolean }): void;
    pinTab(tab: MozTab): void;
    addTabGroup(tabs: MozTab[], opts?: AddTabGroupOptions): MozTabGroup | null;
    removeTabGroup(group: MozTabGroup): void;
    /** Zen's native group edit panel (rename + recolor). `panel.state` is
     *  "open"/"closed"; `close()` dismisses it. */
    tabGroupMenu?: {
      openEditModal(group: MozTabGroup): void;
      panel?: { state: string; hidePopup(): void };
      close?(): void;
    };
    /** Zen's per-window notification box (used by orchestrator.notify). */
    getNotificationBox(): {
      getNotificationWithValue?(value: string): NotificationElement | null;
      removeNotification?(note: NotificationElement): void;
    };
  }

  /** A notification element returned by the notification box. */
  interface NotificationElement {
    messageText?: { textContent?: string };
    label?: string;
    getAttribute?(name: string): string | null;
  }

  const gBrowser: GBrowser;

  /** A Zen workspace record (subset). */
  interface ZenWorkspace {
    uuid: string;
    name: string;
  }

  /** The subset of Zen's global `gZenWorkspaces` the harness drives (CONTROL-7). */
  interface GZenWorkspaces {
    /** UUID of the active workspace. */
    activeWorkspace: string;
    /** The active `<zen-workspace>` element, or null before init. */
    activeWorkspaceElement: Element | null;
    /** Resolves once workspaces have finished initializing. */
    promiseInitialized: Promise<unknown>;
    /** Register a callback fired on every workspace change. */
    addChangeListeners(
      fn: (info: { workspace: ZenWorkspace; onInit: boolean }) => void,
      opts?: { once?: boolean },
    ): void;
    removeChangeListeners(fn: (...args: unknown[]) => void): void;
    /** Create + save a workspace; auto-switches to it unless `dontChange`. */
    createAndSaveWorkspace(
      name?: string,
      icon?: unknown,
      dontChange?: boolean,
    ): Promise<ZenWorkspace>;
    /** Switch to the workspace with the given UUID. */
    changeWorkspaceWithID(uuid: string, ...args: unknown[]): Promise<unknown>;
    getWorkspaces(): ZenWorkspace[];
    removeWorkspace(uuid: string): Promise<unknown> | undefined;
  }

  const gZenWorkspaces: GZenWorkspaces;

  const Services: {
    scriptSecurityManager: { getSystemPrincipal(): unknown };
    prefs: {
      getStringPref(name: string, fallback: string): string;
      setStringPref(name: string, value: string): void;
    };
  };

  /** The public API the userscript exposes on `window` (init()). */
  interface ZenTidyTabsApi {
    run(): void;
    settings(): void;
    mount(): boolean;
    diagnose(): void;
    injectStyles(): void;
    collect(includeGrouped?: boolean): unknown[];
  }

  /** State the re-tidy flicker watcher stashes on `window` (see ZenDriver). */
  interface ReTidyWatchState {
    maxLabelled: number;
    maxDuplicate: number;
    labelsAtPeak: string[];
    obs?: MutationObserver;
    scan?: () => void;
  }

  interface Window {
    zenTidyTabs: ZenTidyTabsApi;
    gZenWorkspaces?: GZenWorkspaces;
    __zenTidyTabsOrigFetch?: typeof fetch;
    __zenTidyTabsFetchCalls?: number;
    /** Body of the most recent stubbed fetch request (the OpenRouter payload). */
    __zenTidyTabsLastBody?: string | null;
    /** Resolves a deferred fetch stub so the in-flight run can complete. */
    __zenTidyTabsRelease?: () => void;
    __zenTidyReTidyWatch?: ReTidyWatchState;
    /** Original `gBrowser.addTabGroup`, stashed by a spec that stubs creation. */
    __zenTidyTabsOrigAddTabGroup?: GBrowser["addTabGroup"];
  }
}
