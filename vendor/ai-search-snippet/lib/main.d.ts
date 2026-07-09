export declare class AISearchClient {
    activeRequests: Map<string, RequestState>;
    baseUrl: string;
    constructor(baseUrl: string);
    private request;
    /**
     * Performs a search query with optional streaming
     */
    search(query: string, options?: Omit<SearchOptions, 'query'>): Promise<SearchResult[]>;
    searchStream(query: string, options?: Omit<SearchOptions, 'query'>): AsyncGenerator<SearchResult | SearchError, void, undefined>;
    chat(query: string, options?: ChatOptions): AsyncGenerator<ChatTypes, void, undefined>;
    /**
     * Consume an SSE stream from the chat/completions endpoint and yield one
     * ChatTextResponse per non-empty content delta. Discards `event: chunks`
     * (RAG sources) and the `[DONE]` sentinel; tolerates malformed individual
     * frames without aborting the whole stream.
     */
    private parseChatStream;
    /**
     * Cancels an active request by ID
     */
    cancelRequest(requestId: string): void;
    /**
     * Cancels all active requests
     */
    cancelAllRequests(): void;
    /**
     * Register an active request
     */
    private registerRequest;
    /**
     * Unregister a completed request
     */
    private unregisterRequest;
    /**
     * Generate unique request ID
     */
    private generateRequestId;
}

/**
 * API error structure
 */
export declare interface ApiError {
    message: string;
    code?: string;
    status?: number;
    details?: Record<string, unknown>;
}

/**
 * Stats Client
 *
 * Sends search analytics events to the `/stats` endpoint as fire-and-forget
 * POST requests. Events are buffered and flushed in batches to reduce request
 * count, and any remaining events are flushed via `navigator.sendBeacon` (or a
 * keepalive `fetch` fallback) when the page is unloaded.
 */
/**
 * Shared fields across every analytics event.
 */
declare interface BaseStatsEvent {
    inputQuery: string;
    snippetVersion: string;
    totalResult: number;
}

export declare class ChatBubbleSnippet extends HTMLElement {
    private shadow;
    private client;
    private chatView;
    private container;
    private isExpanded;
    private isMinimized;
    private translationsOverride;
    private resolvedTranslations;
    private chatQueryRewriteOverride;
    private handleBubbleClick;
    private handleCloseClick;
    private handleMinimizeClick;
    private handleClearClick;
    static get observedAttributes(): readonly ["api-url", "placeholder", "theme", "hide-branding", "translations", "chat-query-rewrite"];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    /**
     * Get the current translations object.
     */
    get translations(): Translations | null;
    /**
     * Override AI Search query rewriting on subsequent chat turns. Setting
     * `null` falls back to parsing the `chat-query-rewrite` attribute.
     */
    get chatQueryRewrite(): SearchSnippetProps['chatQueryRewrite'] | null;
    set chatQueryRewrite(value: SearchSnippetProps['chatQueryRewrite'] | null | undefined);
    /**
     * Override any user-facing string. Omitted keys fall back to English defaults.
     */
    set translations(value: Translations | null | undefined);
    private syncTranslationsFromAttribute;
    private rerenderAfterTranslationsChange;
    private getProps;
    private resolveChatQueryRewrite;
    private initializeClient;
    private render;
    private getBubbleStyles;
    private getBaseHTML;
    private attachEventListeners;
    private removeEventListeners;
    private toggleChat;
    private closeChat;
    private toggleMinimize;
    private initializeChatView;
    private updateTheme;
    private cleanup;
    clearChat(): void;
    sendMessage(content: string): Promise<void>;
    getMessages(): Message[];
}

declare type ChatError = {
    type: 'error';
    message: string;
};

/**
 * A single chat message in the conversation history.
 */
declare interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

/**
 * Chat options
 */
export declare interface ChatOptions {
    stream?: boolean;
    signal?: AbortSignal;
    /** Prior conversation turns to send before the new user query. */
    history?: ChatMessage[];
    /**
     * Enable AI Search query rewriting. Pass `true` to use built-in defaults,
     * an object to override the model and/or rewrite prompt, or omit / pass
     * `false` to disable.
     */
    queryRewrite?: boolean | {
        model?: string;
        rewritePrompt?: string;
    };
}

export declare class ChatPageSnippet extends HTMLElement {
    private shadow;
    private client;
    private chatView;
    private container;
    private sessions;
    private currentSessionId;
    private sidebarCollapsed;
    private translationsOverride;
    private resolvedTranslations;
    private chatQueryRewriteOverride;
    private handleClearClick;
    private handleNewChatClick;
    private handleToggleSidebarClick;
    private handleChatListClick;
    private handleMessageEvent;
    static get observedAttributes(): readonly ["api-url", "placeholder", "theme", "hide-branding", "translations", "chat-query-rewrite"];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    /**
     * Get the current translations object.
     */
    get translations(): Translations | null;
    /**
     * Override AI Search query rewriting on subsequent chat turns. Setting
     * `null` falls back to parsing the `chat-query-rewrite` attribute.
     */
    get chatQueryRewrite(): SearchSnippetProps['chatQueryRewrite'] | null;
    set chatQueryRewrite(value: SearchSnippetProps['chatQueryRewrite'] | null | undefined);
    /**
     * Override any user-facing string. Omitted keys fall back to English defaults.
     */
    set translations(value: Translations | null | undefined);
    private syncTranslationsFromAttribute;
    /**
     * Replace the stored title of any still-default-titled session with the
     * current `newChatButton` translation, so the sidebar reflects the active
     * language after a translations change.
     */
    private refreshDefaultSessionTitles;
    private rerenderAfterTranslationsChange;
    private getProps;
    private resolveChatQueryRewrite;
    private initializeClient;
    private render;
    private getPageStyles;
    private getBaseHTML;
    private attachEventListeners;
    private removeEventListeners;
    private setupView;
    private generateSessionId;
    private loadSessions;
    private saveSessions;
    private saveCurrentSession;
    private updateSessionTitle;
    private createNewChat;
    private switchToSession;
    private deleteSession;
    private clearCurrentChat;
    private toggleSidebar;
    private onChatListClick;
    private renderChatList;
    private renderChatListItem;
    private formatDate;
    private escapeHTML;
    private updateTheme;
    private cleanup;
    clearChat(): void;
    sendMessage(content: string): Promise<void>;
    getMessages(): Message[];
    getSessions(): ChatSession[];
    getCurrentSession(): ChatSession | null;
}

declare type ChatResult = {
    id: string;
    title: string;
    description: string;
    url?: string;
    metadata?: Record<string, unknown>;
    type: 'result';
};

declare interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
    /**
     * True while the session still carries the default (auto-generated) title.
     * Set to false once auto-titled from the first user message, or explicitly
     * renamed. Absent on sessions persisted before this field existed; those
     * are treated as having a default title iff the title string still matches
     * the current `newChatButton` translation (legacy behavior).
     */
    titleIsDefault?: boolean;
}

declare type ChatTextResponse = {
    type: 'text';
    message: string;
};

declare type ChatTypes = ChatResult | ChatTextResponse | ChatError;

/**
 * Fired when a user clicks a specific result in the list.
 */
export declare interface ClickStatsEvent extends BaseStatsEvent {
    clickedResultId: string;
    clickPosition: number;
    clickViewMore: false;
}

export declare const DEFAULT_TRANSLATIONS: Required<Translations>;

/**
 * Merge user-provided translations with built-in defaults.
 *
 * Performs a shallow merge so any omitted keys fall back to English. If
 * `loadingMessages` is provided, it fully replaces the default array.
 */
export declare function mergeTranslations(user?: Translations | null): Required<Translations>;

declare interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

/**
 * Request state
 */
declare interface RequestState {
    id: string;
    controller: AbortController;
    timestamp: number;
}

declare class SearchBarSnippet extends HTMLElement {
    private shadow;
    private client;
    private stats;
    private container;
    private inputElement;
    private resultsContainer;
    private searchButton;
    private debouncedSearch;
    private currentSearchController;
    private loadingMessageInterval;
    private loadingMessageIndex;
    private translationsOverride;
    private resolvedTranslations;
    private lastSearchQuery;
    private lastSearchTotal;
    private handleInputChange;
    private handleInputKeydownEnter;
    private handleInputKeydownEscape;
    private handleSearchButtonClick;
    private handleResultClick;
    private handleSeeMoreClick;
    static get observedAttributes(): readonly ["api-url", "placeholder", "max-results", "max-render-results", "debounce-ms", "theme", "hide-branding", "show-url", "show-date", "hide-thumbnails", "see-more", "group-by", "disable-analytics", "request-options", "translations"];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    /**
     * Get the current translations object. Mirrors the property getter.
     */
    get translations(): Translations | null;
    /**
     * Override any user-facing string. Omitted keys fall back to English defaults.
     */
    set translations(value: Translations | null | undefined);
    /**
     * Re-render preserving the current query and re-running the search so
     * results remain visible after a translations change at runtime.
     */
    private rerender;
    private syncTranslationsFromAttribute;
    private getProps;
    private getRequestOptions;
    private initializeClient;
    private destroyStatsClient;
    private render;
    private attachEventListeners;
    private performSearch;
    private displayResults;
    /**
     * Render results grouped by a metadata field. Groups appear in first-seen
     * order with members in relevance order; the running `flatIndex` keeps each
     * item's `data-index` aligned with its displayed position (used for click
     * analytics), matching the ungrouped path.
     */
    private renderGroupedResults;
    private renderResult;
    private renderResultImage;
    private attachResultHandlers;
    private detachResultTrackingHandlers;
    private showLoadingState;
    private startLoadingInterval;
    private clearLoadingInterval;
    private showEmptyState;
    private showNoResultsState;
    private showErrorState;
    private showMissingApiUrlError;
    private updateTheme;
    private cleanup;
    search(query: string): Promise<void>;
}
export { SearchBarSnippet }
export default SearchBarSnippet;

declare interface SearchError {
    type: 'error';
    message: string;
    code?: string;
    status?: number;
    details?: Record<string, unknown>;
}

export declare class SearchModalSnippet extends HTMLElement {
    private shadow;
    private client;
    private stats;
    private backdrop;
    private modal;
    private inputElement;
    private resultsContainer;
    private footerCount;
    private isOpen;
    private results;
    private activeIndex;
    private debouncedSearch;
    private currentSearchController;
    private loadingMessageInterval;
    private loadingMessageIndex;
    private translationsOverride;
    private resolvedTranslations;
    private lastSearchQuery;
    private lastSearchTotal;
    private handleGlobalKeydown;
    private handleInputChange;
    private handleInputKeydown;
    private handleBackdropClick;
    private handleResultsContainerClick;
    private handleModalScroll;
    static get observedAttributes(): readonly ["api-url", "placeholder", "max-results", "max-render-results", "theme", "shortcut", "use-meta-key", "debounce-ms", "hide-branding", "show-url", "show-date", "hide-thumbnails", "see-more", "group-by", "disable-analytics", "request-options", "translations"];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    /**
     * Get the current translations object.
     */
    get translations(): Translations | null;
    /**
     * Override any user-facing string. Omitted keys fall back to English defaults.
     */
    set translations(value: Translations | null | undefined);
    /**
     * Re-render while preserving open state and the current query. Results are
     * re-fetched so the list reflects the updated translation strings around
     * them (counts, footer hints, etc.). Selection resets to none — the same
     * behavior as the immediate post-search state.
     */
    private rerender;
    private syncTranslationsFromAttribute;
    private getProps;
    private getRequestOptions;
    private initializeClient;
    private destroyStatsClient;
    private render;
    private attachGlobalKeyboardShortcut;
    private attachEventListeners;
    private navigateResults;
    private updateActiveResult;
    private selectActiveResult;
    private performSearch;
    private displayResults;
    /**
     * Render results grouped by a metadata field. Groups appear in first-seen
     * order with their members in relevance order; each group is wrapped in a
     * `role="group"` container with a header label. The running `flatIndex`
     * matches each item's position in `this.results` so keyboard navigation and
     * `data-index` stay consistent with the ungrouped path.
     */
    private renderGroupedResults;
    private renderResult;
    private renderResultImage;
    private attachResultHandlers;
    private detachResultsContainerClick;
    private renderEmptyState;
    private showEmptyState;
    private showLoadingState;
    private startLoadingInterval;
    private clearLoadingInterval;
    private showNoResultsState;
    private showErrorState;
    private showMissingApiUrlError;
    private updateTheme;
    private cleanup;
    /**
     * Open the search modal
     */
    open(): void;
    /**
     * Close the search modal
     */
    close(): void;
    /**
     * Toggle the search modal open/closed
     */
    toggle(): void;
    /**
     * Perform a search programmatically
     */
    search(query: string): Promise<void>;
    /**
     * Get current search results
     */
    getResults(): SearchResult[];
    /**
     * Check if modal is currently open
     */
    isModalOpen(): boolean;
}

/**
 * Search options
 */
export declare interface SearchOptions {
    query?: string;
    streaming?: boolean;
    signal?: AbortSignal;
    /** Maximum search results to request from the API */
    maxResults?: number;
    /** Additional request fields for search endpoints */
    request?: SearchRequestOptions;
}

/**
 * Additional request fields for search requests
 */
export declare interface SearchRequestOptions {
    /** Additional JSON fields to merge into the request body */
    body?: Record<string, unknown>;
    /** Additional headers to send with the request */
    headers?: Record<string, string>;
    /** Additional query parameters to append to the request URL */
    queryParams?: Record<string, boolean | number | string | null | undefined>;
}

/**
 * Search result item structure
 */
export declare interface SearchResult {
    id: string;
    title: string;
    description: string;
    timestamp?: number;
    url?: string;
    image?: string;
    metadata?: Record<string, unknown>;
    type: 'result';
}

/**
 * Main component properties
 */
export declare interface SearchSnippetProps {
    /** Required: AI Search API endpoint */
    apiUrl: string;
    /** Input placeholder text */
    placeholder?: string;
    /** Maximum search results to request from the API */
    maxResults?: number;
    /** Maximum search results to render in the UI (caps the visible list and drives the "see more" affordance) */
    maxRenderResults?: number;
    /** Input debounce delay in milliseconds (search-bar only) */
    debounceMs?: number;
    /** Color scheme */
    theme?: Theme;
    /** Hide the "Powered by Cloudflare AI Search" branding */
    hideBranding?: boolean;
    /** Show URL in search results (default: false) */
    showUrl?: boolean;
    /** Show date in search results when timestamp is present (default: false) */
    showDate?: boolean;
    /** Hide thumbnails in search results (default: false) */
    hideThumbnails?: boolean;
    /** URL template for "See more" link. The search query is appended URL-encoded. Example: "https://example.com/search?q=" */
    seeMore?: string;
    /**
     * Group rendered results by this item metadata field (e.g. "group" or
     * "product"). Groups are ordered by the first result that appears in each,
     * and results within a group keep their relevance order. Results missing the
     * field fall into an "Other" bucket. Omit to render a flat, ungrouped list.
     */
    groupBy?: string;
    /**
     * Disable sending search / click / view-more analytics events to the
     * `/stats` endpoint. Defaults to `false` (analytics enabled).
     */
    disableAnalytics?: boolean;
    /**
     * Override any user-facing string. Omitted keys fall back to English defaults.
     *
     * @example
     * ```ts
     * element.translations = { placeholder: 'Busca aquí...' };
     * ```
     */
    translations?: Translations;
    /**
     * Customize AI Search query rewriting on subsequent chat turns.
     *
     * Query rewriting is automatically enabled from the second user message
     * onward (the first message has no history to rewrite from). Use this to
     * override the model, the rewrite prompt, or to disable the feature.
     *
     * @example
     * ```ts
     * element.chatQueryRewrite = { enabled: false };
     * element.chatQueryRewrite = { model: 'openai/gpt-5-mini' };
     * element.chatQueryRewrite = { rewritePrompt: 'Rewrite the latest user message...' };
     * ```
     */
    chatQueryRewrite?: {
        /** Override the auto-enable behavior. Defaults to true on subsequent turns. */
        enabled?: boolean;
        /** Override the rewriter model. Defaults to '@cf/meta/llama-3.3-70b-instruct-fp8-fast'. */
        model?: string;
        /** Override the system prompt sent as `rewrite_prompt`. Defaults to a built-in prompt. */
        rewritePrompt?: string;
    };
}

/**
 * Fired after a search completes successfully (or returns zero results).
 * Click-related fields are intentionally omitted.
 */
export declare type SearchStatsEvent = BaseStatsEvent;

export declare class StatsClient {
    private readonly baseUrl;
    private readonly endpoint;
    private readonly snippetVersion;
    private readonly flushIntervalMs;
    private readonly maxBufferSize;
    private buffer;
    private flushTimer;
    private destroyed;
    private readonly boundUnloadHandler;
    private readonly boundVisibilityHandler;
    constructor(baseUrl: string, options?: StatsClientOptions);
    /**
     * Record a completed search (no click).
     */
    trackSearch(inputQuery: string, totalResult: number): void;
    /**
     * Record a click on a specific result.
     */
    trackClick(inputQuery: string, totalResult: number, clickedResultId: string, clickPosition: number): void;
    /**
     * Record a click on the "See more" link.
     */
    trackViewMore(inputQuery: string, totalResult: number): void;
    /**
     * Buffer a pre-built event. Higher-level `track*` helpers call this.
     */
    track(event: StatsEvent): void;
    /**
     * Force an immediate flush using `fetch` with `keepalive: true`.
     * Returns synchronously; network errors are swallowed.
     */
    flush(): void;
    /**
     * Flush path optimized for page-unload. Prefers `navigator.sendBeacon`
     * when available; falls back to `fetch({ keepalive: true })`.
     */
    private flushBeacon;
    /**
     * Remove unload listeners, clear timers, and flush anything still buffered.
     * Call from the host component's `disconnectedCallback`.
     */
    destroy(): void;
    private scheduleFlush;
    private drainBuffer;
    private buildUrl;
}

export declare interface StatsClientOptions {
    /** Overrides the library version placed on each event. Defaults to the built-in `SNIPPET_VERSION`. */
    snippetVersion?: string;
    /** Milliseconds to wait before auto-flushing a non-empty buffer. Defaults to 1500ms. */
    flushIntervalMs?: number;
    /** Buffer size that triggers an immediate flush. Defaults to 20. */
    maxBufferSize?: number;
    /** Path appended to `baseUrl`. Defaults to `/stats`. */
    endpoint?: string;
}

export declare type StatsEvent = SearchStatsEvent | ClickStatsEvent | ViewMoreStatsEvent;

export declare type Theme = 'light' | 'dark' | 'auto';

/**
 * Translation utilities for component user-facing strings.
 *
 * Users override any subset of translations via the `translations` attribute
 * (JSON string) or property (plain object). Missing keys fall back to the
 * built-in English defaults.
 *
 * @example
 * ```html
 * <search-bar-snippet translations='{"placeholder":"Busca aqu\u00ed..."}'></search-bar-snippet>
 * ```
 *
 * @example
 * ```ts
 * element.translations = { placeholder: 'Busca aquí...' };
 * ```
 */
/**
 * All user-facing strings rendered by the snippet components.
 *
 * All keys are optional; unspecified keys fall back to English defaults.
 * Strings can contain `{name}` tokens that are interpolated at render time.
 */
export declare interface Translations {
    /** Aria label for loading spinners. Default: "Loading" */
    loadingAriaLabel?: string;
    /** Bold prefix for error messages. Default: "Error:" */
    errorPrefix?: string;
    /** Message shown when the `api-url` attribute is missing. */
    missingApiUrlError?: string;
    /** Branding prefix before the product link. Default: "Powered by" */
    poweredBy?: string;
    /** Branding link label. Default: "Cloudflare AI Search" */
    poweredByLinkLabel?: string;
    /** Search input placeholder text. */
    placeholder?: string;
    /** Search submit button text and aria-label. */
    searchButtonLabel?: string;
    /** Aria-label for the search input on the bar variant. */
    searchInputAriaLabel?: string;
    /** Aria-label for the modal results list. */
    searchResultsAriaLabel?: string;
    /** Title shown before a user enters a query (bar variant). */
    emptyStateTitle?: string;
    /** Description shown before a user enters a query (bar variant). */
    emptyStateDescription?: string;
    /** Description shown before a user enters a query (modal variant). */
    modalEmptyStateDescription?: string;
    /** Title shown when a search returns no results (bar variant). */
    noResultsTitle?: string;
    /** Description shown when a search returns no results (bar variant). Supports `{query}`. */
    noResultsDescription?: string;
    /** Title shown when a search returns no results (modal variant). */
    modalNoResultsTitle?: string;
    /** Description shown when a search returns no results (modal variant). Supports `{query}`. */
    modalNoResultsDescription?: string;
    /** Bar results count when exactly 1 result. Supports `{n}`. */
    resultsCount?: string;
    /** Bar results count when multiple results. Supports `{n}`. */
    resultsCountPlural?: string;
    /** Bar/modal results count when truncated. Supports `{n}` and `{total}`. */
    resultsCountOverflow?: string;
    /** Modal footer results count when exactly 1 result. Supports `{n}`. */
    modalResultsCount?: string;
    /** Modal footer results count when multiple results. Supports `{n}`. */
    modalResultsCountPlural?: string;
    /** Modal footer count shown with the zero-results state. */
    modalResultsCountZero?: string;
    /** Modal footer text shown with the error state. */
    modalResultsCountError?: string;
    /** Label for the "see more" link when `see-more` is configured. */
    seeMoreResults?: string;
    /** Group header label for results missing the `group-by` metadata field. Default: "Other" */
    groupOther?: string;
    /** Modal footer hint next to the ↑ ↓ keys. */
    navigateHint?: string;
    /** Modal footer hint next to the ↵ key. */
    selectHint?: string;
    /** Modal footer hint next to the Esc key. */
    closeHint?: string;
    /** Chat header title. */
    chatTitle?: string;
    /** Chat input placeholder text. */
    chatPlaceholder?: string;
    /** Aria-label for the chat textarea. */
    chatInputAriaLabel?: string;
    /** Chat send button text. */
    sendButtonLabel?: string;
    /** Chat send button aria-label. */
    sendButtonAriaLabel?: string;
    /** Empty chat state title. */
    chatEmptyTitle?: string;
    /** Empty chat state description. */
    chatEmptyDescription?: string;
    /** User message avatar text. Default: "U" */
    userAvatar?: string;
    /** Assistant message avatar text. Default: "AI" */
    assistantAvatar?: string;
    /** Fallback for chat errors with no message. */
    unknownError?: string;
    /** Aria-label for the floating chat bubble button. */
    openChatAriaLabel?: string;
    /** Aria-label for the clear-history icon button. */
    clearHistoryAriaLabel?: string;
    /** Aria-label for the minimize icon button. */
    minimizeAriaLabel?: string;
    /** Aria-label for the close icon button. */
    closeAriaLabel?: string;
    /** Sidebar heading on the chat-page variant. */
    historyTitle?: string;
    /** New-chat button label. */
    newChatButton?: string;
    /** Clear-chat header button label. */
    clearChatButton?: string;
    /** Tooltip for the sidebar toggle button. */
    toggleSidebarTitle?: string;
    /** Tooltip for a per-session delete button. */
    deleteChatTitle?: string;
    /** Empty sessions list message. */
    noChatsYet?: string;
    /** Label for "one day ago" in the sessions list. */
    yesterday?: string;
    /** Relative timestamp for < 1 minute ago. */
    justNow?: string;
    /** Relative timestamp for exactly 1 minute ago. Supports `{n}`. */
    minuteAgo?: string;
    /** Relative timestamp for 2-59 minutes ago. Supports `{n}`. */
    minutesAgo?: string;
    /** Relative timestamp for exactly 1 hour ago. Supports `{n}`. */
    hourAgo?: string;
    /** Relative timestamp for 2-23 hours ago. Supports `{n}`. */
    hoursAgo?: string;
    /** Cycling loading messages shown during search/streaming. Provide the full array to override. */
    loadingMessages?: string[];
}

/**
 * Fired when a user clicks the "See more" affordance beneath the results.
 */
export declare interface ViewMoreStatsEvent extends BaseStatsEvent {
    clickViewMore: true;
}

export { }
