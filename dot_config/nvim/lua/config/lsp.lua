if vim.fn.executable("sourcekit-lsp") == 1 then
	vim.lsp.enable("sourcekit")
end
