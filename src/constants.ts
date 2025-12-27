/**
 * dslop Configuration Constants
 * 
 * All tweakable values are centralized here for easy tuning.
 * These values were derived from analysis of real codebases like turf.
 */

// =============================================================================
// CLI DEFAULTS
// =============================================================================

/** Default minimum block size in lines */
export const DEFAULT_MIN_LINES = 4;

/** Default similarity threshold (0-1) */
export const DEFAULT_SIMILARITY = 0.70;

/** Default file extensions to scan */
export const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx"];

/** Default patterns to ignore */
export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  "dist",
  ".git",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  // Generated/data files that often have intentional repetition
  "drizzle/migrations",
  "migrations",
  "assets/data",
  "__generated__",
  ".generated",
  "generated",
];

// =============================================================================
// SCANNER CONFIGURATION
// =============================================================================

/** Maximum block size to extract (in lines) */
export const MAX_BLOCK_SIZE = 100;

/** Block size growth multiplier for multi-granularity extraction */
export const BLOCK_SIZE_MULTIPLIER = 1.5;

/** 
 * Minimum ratio of meaningful lines in a block (0-1)
 * Blocks with fewer meaningful lines are skipped
 */
export const MIN_MEANINGFUL_LINE_RATIO = 0.6;

/** 
 * Sliding window step divisor
 * Step = blockSize / STEP_DIVISOR
 * Lower = more overlap = more blocks = slower but more thorough
 */
export const SLIDING_WINDOW_STEP_DIVISOR = 2;

/** 
 * Lines to skip when filtering meaningful content
 * These are considered "noise" and don't count toward meaningful content
 */
export const SKIP_LINE_PREFIXES = [
  "//",      // Single-line comments
  "/*",      // Multi-line comment start
  "*",       // Multi-line comment continuation
  "import ", // Import statements
  "export {", // Re-exports
];

/**
 * Minimum number of non-trivial characters per line on average
 * Blocks with too few meaningful characters are skipped
 */
export const MIN_AVG_LINE_LENGTH = 10;

/**
 * Trivial line patterns that don't count as meaningful
 * Lines matching these regex patterns are considered boilerplate
 */
export const TRIVIAL_LINE_PATTERNS = [
  /^\s*[{}\[\]();,]\s*$/, // Just brackets/punctuation
  /^\s*}\s*[);,]?\s*$/,   // Closing braces with optional punctuation  
  /^\s*\)\s*[;,]?\s*$/,   // Closing parens
  /^\s*\]\s*[;,]?\s*$/,   // Closing brackets
  /^\s*$/,                 // Empty lines
];

// =============================================================================
// DETECTOR CONFIGURATION
// =============================================================================

/** 
 * Size bucket divisor for grouping blocks by approximate size
 * Blocks are grouped into buckets of size / SIZE_BUCKET_DIVISOR
 */
export const SIZE_BUCKET_DIVISOR = 5;

/** 
 * Maximum blocks to sample for average similarity calculation
 * Higher = more accurate but slower
 */
export const MAX_SIMILARITY_SAMPLES = 5;

/** 
 * Minimum occurrences for a group to be reported
 */
export const MIN_OCCURRENCES = 2;

/** 
 * Overlap threshold for deduplicating groups (0-1)
 * Groups with more than this ratio of matches already covered are skipped
 */
export const GROUP_OVERLAP_THRESHOLD = 0.5;

// =============================================================================
// NORMALIZER CONFIGURATION
// =============================================================================

/** Placeholder for normalized string literals */
export const STRING_PLACEHOLDER = "<STRING>";

/** Placeholder for normalized template literals */
export const TEMPLATE_PLACEHOLDER = "<TEMPLATE>";

/** Placeholder for normalized numeric literals */
export const NUMBER_PLACEHOLDER = "<NUMBER>";

/** Placeholder for normalized hex color codes */
export const COLOR_PLACEHOLDER = "<COLOR>";

/** 
 * Keywords to preserve during aggressive normalization
 * These are not replaced with identifier placeholders
 */
export const PRESERVED_KEYWORDS = new Set([
  // JavaScript/TypeScript keywords
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "try", "catch", "finally",
  "throw", "new", "class", "extends", "import", "export", "from", "default",
  "async", "await", "yield", "typeof", "instanceof", "in", "of", "this",
  "super", "null", "undefined", "true", "false", "void", "delete",
  "interface", "type", "enum", "implements", "private", "public", "protected",
  "static", "readonly", "abstract", "as", "is", "keyof", "never", "unknown",
  
  // Common React/JS patterns
  "React", "useState", "useEffect", "useCallback", "useMemo", "useRef",
  "useContext", "useReducer", "useLayoutEffect", "useImperativeHandle",
  "View", "Text", "Image", "Pressable", "TouchableOpacity", "ScrollView",
  "FlatList", "StyleSheet", "Animated", "Platform",
  
  // Common utilities
  "console", "log", "error", "warn", "info", "debug",
  "JSON", "stringify", "parse",
  "Object", "Array", "String", "Number", "Boolean", "Map", "Set", "WeakMap", "WeakSet",
  "Promise", "Error", "Date", "Math", "RegExp",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "fetch", "Response", "Request", "Headers",
  
  // Zod (common in schema definitions)
  "z", "object", "string", "number", "boolean", "array", "enum", "optional",
  "nullable", "union", "intersection", "literal", "tuple", "record",
  
  // Drizzle ORM (common in DB schemas)
  "pgTable", "text", "integer", "timestamp", "jsonb", "boolean", "serial",
  "varchar", "decimal", "real", "doublePrecision", "bigint", "smallint",
  "references", "notNull", "default", "primaryKey", "unique", "index",
]);

// =============================================================================
// OUTPUT FORMATTING
// =============================================================================

/** Maximum path length before truncation */
export const MAX_PATH_DISPLAY_LENGTH = 60;

/** Number of context lines to show in code preview */
export const CODE_PREVIEW_CONTEXT_LINES = 3;

/** Maximum number of matches to show per group in summary */
export const MAX_MATCHES_IN_SUMMARY = 5;

/** Maximum number of groups to show in detailed output */
export const MAX_GROUPS_DETAILED = 20;

/** Separator line for output sections */
export const SECTION_SEPARATOR = "─".repeat(80);

/** 
 * ANSI color codes for terminal output
 * Set to empty strings to disable colors
 */
export const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// =============================================================================
// PERFORMANCE TUNING
// =============================================================================

/** 
 * Maximum number of blocks to process before showing progress
 * Set to 0 to disable progress reporting
 */
export const PROGRESS_REPORT_INTERVAL = 1000;

/** 
 * Maximum file size to process (in bytes)
 * Files larger than this are skipped
 */
export const MAX_FILE_SIZE = 1024 * 1024; // 1MB

/** 
 * Maximum total blocks to compare for similarity
 * If exceeded, only exact matches are found (much faster)
 */
export const MAX_BLOCKS_FOR_SIMILARITY = 10000;
