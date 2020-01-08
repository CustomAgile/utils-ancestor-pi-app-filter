Ext.define('CustomAgile.multilevelfilter.ToggleButton', {
    extend: 'Rally.ui.Button',
    alias: 'widget.multifiltertogglebtn',

    stateful: true,

    config: {
        iconCls: 'icon-filter'
    },

    constructor: function (config) {
        this.mergeConfig(config);
        this.callParent([this.config]);
    },

    getState: function () {
        return {
            filtersHidden: this.filtersHidden
        };
    },

    setFiltersHidden: function (filtersHidden) {
        this.filtersHidden = filtersHidden;
        this.saveState();
    }
});