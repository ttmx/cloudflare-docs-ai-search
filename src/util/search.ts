export const openGlobalSearch = (searchTerm?: string) => {
	const modal = document.querySelector("search-modal-snippet") as
		| (HTMLElement & { open?: () => void; search?: (query: string) => void })
		| null;
	if (!modal) return;

	// search() opens the modal and runs the query; open() just opens it.
	if (searchTerm) modal.search?.(searchTerm);
	else modal.open?.();
};
