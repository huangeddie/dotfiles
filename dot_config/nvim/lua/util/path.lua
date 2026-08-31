local M = {}

---@class CopyPathOptions
---@field annotated? boolean     -- Prefix with '@' (e.g. '@path/to/file')
---@field dir_only? boolean      -- Copy directory instead of file (e.g. 'path/to')
---@field link? boolean          -- Format as web/CodeSearch URL
---@field link_prefix? string    -- URL prefix (e.g. 'http://google3/')
---@field head_prefix? string    -- Head depot prefix (e.g. '/google/src/head/depot/')
---@field all_buffers? boolean   -- Copy all listed open buffer paths
---@field root_resolver? fun(full_path: string): string? -- Custom root extractor

--- Formats the relative path based on given options and visual range.
---@param full_path string
---@param project_root string
---@param opts? CopyPathOptions
---@param range? {start_line: integer, end_line: integer}
---@return string?
function M.format_path(full_path, project_root, opts, range)
  error("not implemented")
end

--- Formats all listed open buffer paths.
---@param bufs integer[]
---@param project_root string
---@param opts? CopyPathOptions
---@return string
function M.format_all_buffers(bufs, project_root, opts)
  error("not implemented")
end

--- Copy string to system clipboard with OSC 52 fallback.
---@param text string
function M.copy_to_os_clipboard(text)
  error("not implemented")
end

--- Orchestrates buffer reading, line range extraction, formatting, and clipboard copy.
---@param opts? CopyPathOptions
function M.copy_path(opts)
  error("not implemented")
end

return M
