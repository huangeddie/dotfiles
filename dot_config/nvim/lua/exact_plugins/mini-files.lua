-- ~/.config/nvim/lua/plugins/mini-files.lua
--
-- mini.files with an in-explorer sort toggle:
--   gsn -> by name (default)
--   gsm -> by last modified (newest first)
--   gss -> by size (largest first)
--   gse -> by extension
return {
	"nvim-mini/mini.files",
	config = function(_, opts)
		local MiniFiles = require("mini.files")
		-- ---------- Sort functions ----------
		-- mini.files passes the whole entry list; we return it sorted.
		-- Each entry has: fs_type ("file"|"directory"), name, path.
		local sorts = {}
		sorts.name = MiniFiles.default_sort
		sorts.modified = function(fs_entries)
			local out = {}
			for _, e in ipairs(fs_entries) do
				local stat = vim.uv.fs_stat(e.path)
				table.insert(out, vim.tbl_extend("force", e, { mtime = stat and stat.mtime.sec or 0 }))
			end
			table.sort(out, function(a, b)
				if a.fs_type ~= b.fs_type then
					return a.fs_type == "directory"
				end
				return a.mtime > b.mtime
			end)
			return out
		end
		sorts.size = function(fs_entries)
			local out = {}
			for _, e in ipairs(fs_entries) do
				local stat = vim.uv.fs_stat(e.path)
				table.insert(out, vim.tbl_extend("force", e, { size = stat and stat.size or 0 }))
			end
			table.sort(out, function(a, b)
				if a.fs_type ~= b.fs_type then
					return a.fs_type == "directory"
				end
				return a.size > b.size
			end)
			return out
		end
		sorts.extension = function(fs_entries)
			local out = vim.deepcopy(fs_entries)
			table.sort(out, function(a, b)
				if a.fs_type ~= b.fs_type then
					return a.fs_type == "directory"
				end
				local a_ext = a.name:match("%.([^.]+)$") or ""
				local b_ext = b.name:match("%.([^.]+)$") or ""
				if a_ext ~= b_ext then
					return a_ext < b_ext
				end
				return a.name:lower() < b.name:lower()
			end)
			return out
		end
		-- ---------- Setup with default sort ----------
		opts = opts or {}
		opts.content = vim.tbl_extend("force", opts.content or {}, { sort = sorts.modified })
		MiniFiles.setup(opts)
		-- ---------- Toggle helper ----------
		local current_sort = "modified"
		local function set_sort(name)
			if not sorts[name] then
				return
			end
			current_sort = name
			-- Passing `content` to refresh forces all directory buffers to re-read.
			-- Mutating MiniFiles.config.content.sort + bare refresh() won't re-sort.
			MiniFiles.refresh({ content = { sort = sorts[name] } })
			vim.notify("mini.files: sort by " .. name, vim.log.levels.INFO)
		end
		-- ---------- Buffer-local mappings inside the explorer ----------
		vim.api.nvim_create_autocmd("User", {
			pattern = "MiniFilesBufferCreate",
			callback = function(args)
				local buf = args.data.buf_id
				local map = function(lhs, rhs, desc)
					vim.keymap.set("n", lhs, rhs, { buffer = buf, desc = desc, nowait = true })
				end
				map("gsn", function()
					set_sort("name")
				end, "Sort by name")
				map("gsm", function()
					set_sort("modified")
				end, "Sort by modified")
				map("gss", function()
					set_sort("size")
				end, "Sort by size")
				map("gse", function()
					set_sort("extension")
				end, "Sort by extension")
			end,
		})
		-- Optional: expose current sort name for statusline etc.
		_G.MiniFilesCurrentSort = function()
			return current_sort
		end
	end,
}
