---@brief
---
--- https://github.com/swiftlang/sourcekit-lsp
---
--- Language server for Swift.
return {
	cmd = { "sourcekit-lsp" },
	filetypes = { "swift" },
	root_markers = {
		".git",
		"compile_commands.json",
		".sourcekit-lsp",
		"Package.swift",
	},
	get_language_id = function(_, ftype)
		return ftype
	end,
	capabilities = {
		workspace = {
			didChangeWatchedFiles = {
				dynamicRegistration = true,
			},
		},
		textDocument = {
			diagnostic = {
				dynamicRegistration = true,
				relatedDocumentSupport = true,
			},
		},
	},
}
