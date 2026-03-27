(function() {
    if (window.kendo && window.jQuery) {
        var grid = window.jQuery("#Sales").data("kendoGrid");
        if (grid) {
            grid.dataSource.pageSize(300);
        }
    }
})();