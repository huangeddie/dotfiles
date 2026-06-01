return {
  "christoomey/vim-tmux-navigator",
  cmd = {
    "TmuxNavigateLeft",
    "TmuxNavigateDown",
    "TmuxNavigateUp",
    "TmuxNavigateRight",
    "TmuxNavigatePrevious",
    "TmuxNavigatorProcessList",
  },
  keys = {
    { "<c-h>",  "<cmd><C-U>TmuxNavigateLeft<cr>", mode = { "n", "x" } },
    { "<c-j>",  "<cmd><C-U>TmuxNavigateDown<cr>", mode = { "n", "x" } },
    { "<c-k>",  "<cmd><C-U>TmuxNavigateUp<cr>", mode = { "n", "x" } },
    { "<c-l>",  "<cmd><C-U>TmuxNavigateRight<cr>", mode = { "n", "x" } },
    { "<c-\\>", "<cmd><C-U>TmuxNavigatePrevious<cr>", mode = { "n", "x" } },
  },
}
