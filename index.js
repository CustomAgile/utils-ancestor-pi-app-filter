Ext.define('Utils.AncestorPiAppFilter', {
    alias: 'plugin.UtilsAncestorPiAppFilter',
    mixins: [
        'Ext.AbstractPlugin',
        'Rally.Messageable'
    ],
    extend: 'Ext.Component',

    statics: {
        RENDER_AREA_ID: 'utils-ancestor-pi-app-filter',
        PANEL_RENDER_AREA_ID: 'multi-level-pi-app-filter-panel'
    },

    config: {
        /**
         * @cfg {Boolean}
         * The id of the component where the plugin will render its controls
         */
        renderAreaId: 'utils-ancestor-pi-app-filter',

        /**
         * @cfg {String}
         * The id of the component where the filter button will render itself
         */
        btnRenderAreaId: 'utils-ancestor-pi-app-filter',

        /**
         * @cfg {String}
         * The id of the component where the tabbed filter panel will render itself
         */
        panelRenderAreaId: 'multi-level-pi-app-filter-panel',

        /**
         * @cfg {Boolean}
         * Set to false to prevent app from displaying a multi-level PI filter
         */
        displayMultiLevelFilter: true,

        /**
         * @cfg {Boolean}
         * Set to true to indicate that this component is a publisher of events
         * to other apps using this plugin
         */
        publisher: false,

        /**
         * @cfg {Boolean}
         * Set to false to prevent the '-- None --' selection option if your app can't support
         * querying by a null ancestor (e.g. Lookback _ItemHierarchy)
         */
        allowNoEntry: true,

        /**
         * @cfg {Object}
         * Config applied to the app settings components
         */
        settingsConfig: {},

        /**
         * @cfg {Object}
         * Fetch list for PI Selector
         */
        defaultFetch: true,

        /**
         * @cfg {Array}
         * Whitelist array for inline filters
         */
        whiteListFields: ['Tags', 'Milstones'],

        /**
         * @cfg {Array}
         * Blacklist array for inline filters
         */
        blackListFields: [],

        /**
         * @cfg {Boolean}
         * Setting for inlineFilterButtonConfig
         */
        filterChildren: false,

        /**
         * @cfg {String}
         * Label of the Portfolio Item Type picker
         */
        ancestorLabel: 'With ancestor',

        /**
         * @cfg {Number}
         * Width of the Portfolio Item Type picker label
         */
        ancestorLabelWidth: 110,

        /**
         * @cfg {String}
         * Label of the Portfolio Item Type picker when shown with the ancestor filter
         */
        ownerLabel: 'and owned by',

        /**
         * @cfg {String}
         * Label of the Portfolio Item Type picker when shown by itself
         */
        ownerOnlyLabel: 'Owned by',

        /**
         * @cfg {Number}
         * Width of the Portfolio Item Type picker label
         */
        ownerLabelWidth: 110,


        /**
         * @cfg {Number}
         * Style of the Portfolio Item Type picker label
         */
        labelStyle: 'font-size: medium',

        /**
         * @cfg {Number}
         * Minimum width for single row layout
         */
        singleRowMinWidth: 840,

        /**
         * @cfg {Array}
         * Field list for multi-level filter panel
         */
        defaultFilterFields: ['ArtifactSearch', 'Owner'],

        /**
         * @cfg {Boolean}
         * Set to true to hide filters on load
         */
        filtersHidden: false,

        /**
         * @cfg {Boolean}
         * Set to true to hide advanced filters on load
         */
        advancedFilterCollapsed: false
    },
    filterControls: [],
    portfolioItemTypes: [],
    readyDeferred: null,
    piTypesDeferred: null,
    isSubscriber: false,
    changeSubscribers: [],
    publishedValue: {},

    constructor: function () {
        this.callParent(arguments);
        this._setupPubSub();
        Ext.tip.QuickTipManager.init();
    },

    initComponent: function () {
        this.callParent(arguments);
        this.addEvents('ready', 'select', 'change');
    },

    init: function (cmp) {
        this.cmp = cmp;

        this.cmp.on('resize', this._onCmpResize, this);

        // Get the area where plugin controls will render
        this.renderArea = this.cmp.down('#' + this.renderAreaId);

        // Get the area where filter button will render
        this.btnRenderArea = this.cmp.down('#' + this.btnRenderAreaId);

        // Get the area where tabbed filter panel will render
        this.panelRenderArea = this.cmp.down('#' + this.panelRenderAreaId);

        // Extend app settings fields
        var cmpGetSettingsFields = this.cmp.getSettingsFields;
        this.cmp.getSettingsFields = function () {
            return this._getSettingsFields(cmpGetSettingsFields.apply(cmp, arguments));
        }.bind(this);

        // Extend app default settings fields
        var appDefaults = this.cmp.defaultSettings;
        appDefaults['Utils.AncestorPiAppFilter.enableAncestorPiFilter2'] = false;
        appDefaults['Utils.AncestorPiAppFilter.projectScope'] = 'current';
        appDefaults['Utils.AncestorPiAppFilter.enableMultiLevelPiFilter'] = false;
        this.cmp.setDefaultSettings(appDefaults);

        Ext.override(Rally.ui.inlinefilter.InlineFilterPanel, {
            // We don't want chevrons in the tab panel
            _alignChevron: function () {
                if (this.chevron) { this.chevron.hide(); }
            }
        });

        // Add the control components then fire ready
        Rally.data.util.PortfolioItemHelper.getPortfolioItemTypes().then({
            scope: this,
            success: function (piTypes) {
                this.portfolioItemTypes = piTypes;
                Promise.all([this._addAncestorControls(), this._addFilters()]).then(
                    function () {
                        this._setReady();
                    }.bind(this),
                    function (error) {
                        Rally.ui.notify.Notifier.showError({ message: error });
                        this._setReady();
                    }.bind(this)
                );
            },
            failure: function () {
                Rally.ui.notify.Notifier.showError({ message: 'Failed to fetch portfolio item types for multi-level filter' });
            }
        });
    },

    notifySubscribers: function (changeType) {
        var data = this._getValue();
        data.changeType = changeType;
        _.each(this.changeSubscribers, function (subscriberName) {
            this.publish(subscriberName, data);
        }, this);
    },

    // Returns a filter that will ensure results are children of the
    // selected ancestor portfolio item. type is the TypeDefinition 
    // for the Portfolio Item level you wish to fetch.
    getAncestorFilterForType: function (type) {
        var filter;
        var modelName = type.toLowerCase();
        var currentValues = this._getValue();

        if (currentValues.piTypePath) {
            var selectedPiTypePath = currentValues.piTypePath;
            var selectedRecord = currentValues.isPiSelected;
            var selectedPi = currentValues.pi;
            var pisAbove = this._piTypeAncestors(modelName, selectedPiTypePath);
            if (selectedRecord && selectedPi !== null && pisAbove !== null) {
                var property = this._propertyPrefix(modelName, pisAbove);
                if (property) {
                    filter = new Rally.data.wsapi.Filter({
                        property: property,
                        value: selectedPi
                    });
                }
            }
            else if (selectedPi !== null) {
                // Filter out any items of this type because the ancestor pi filter is
                // enabled, but this type doesn't have any pi ancestor types
                filter = new Rally.data.wsapi.Filter({
                    property: 'ObjectID',
                    value: 0
                });
            }
        }

        return filter;
    },

    // Returns an array containing all of the filters applied in the
    // multi-level filter as well as the selected ancestor PI if one
    // is selected. 
    // type is the TypeDefinition.TypePath for the Portfolio Item level you wish to fetch.
    getAllFiltersForType: async function (type, includeFiltersBelowType) {
        let ancestorFilter = this.getAncestorFilterForType(type);
        let filters = ancestorFilter ? [ancestorFilter] : [];
        let multiFilters = await this.getMultiLevelFiltersForType(type, includeFiltersBelowType);
        filters = filters.concat(multiFilters);

        return filters;
    },

    // Returns an array containing all of the filters applied in the multi-level filter for a given PI type. 
    // Type is the TypeDefinition.TypePath for the Portfolio Item level you wish to fetch.
    getMultiLevelFiltersForType: async function (type, includeFiltersBelowType) {
        let filters = [];
        let modelName = type.toLowerCase();
        let multiLevelFilters = this.getMultiLevelFilters();
        let keys = Object.keys(multiLevelFilters);

        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let val = multiLevelFilters[key];

            if (val.length) {
                // If scoping all projects, filter releases by name instead of value
                await this._convertReleaseFilters(val);

                if (modelName === key.toLowerCase()) {
                    filters = filters.concat(val);
                }
                else {
                    let pisAbove = this._piTypeAncestors(modelName, key);

                    if (pisAbove !== null) {
                        let property = this._propertyPrefix(modelName, pisAbove);
                        if (property) {
                            let currentLevelFilters = [];
                            let currentLevelFiltersWithoutParentPrefix = [];
                            let hasCustomFieldFilters = false;
                            _.each(val, function (filter) {
                                // Rally has a hard time filtering on custom dropdown fields on parents so
                                // we check to see if any are applied
                                if (filter.property.indexOf('c_') !== -1 && typeof filter.value === 'string') {
                                    hasCustomFieldFilters = true;
                                }

                                // List of filters if custom field filters exist
                                currentLevelFiltersWithoutParentPrefix.push(new Rally.data.wsapi.Filter({
                                    property: filter.property,
                                    operator: filter.operator,
                                    value: filter.value
                                }));

                                // List of filters if no custom field filters exist
                                currentLevelFilters.push(new Rally.data.wsapi.Filter({
                                    property: `${property}.${filter.property}`,
                                    operator: filter.operator,
                                    value: filter.value
                                }));
                            }.bind(this));

                            // If filters on custom fields exist, lets get a list of IDs at that level and use those IDs as our filter
                            if (hasCustomFieldFilters) {
                                let parentIDs = [];
                                try {
                                    parentIDs = await new Promise(function (resolve) { this._getFilteredIds(currentLevelFiltersWithoutParentPrefix, key, resolve); }.bind(this));
                                    if (parentIDs.length) {
                                        filters.push(new Rally.data.wsapi.Filter({
                                            property: property + '.ObjectID',
                                            operator: 'in',
                                            value: _.map(parentIDs, function (id) { return id.get('ObjectID'); })
                                        }));
                                    }
                                    else {
                                        filters.push(new Rally.data.wsapi.Filter({
                                            property: property + '.ObjectID',
                                            operator: '=',
                                            value: 0
                                        }));
                                    }
                                }
                                catch (e) {
                                    return [new Rally.data.wsapi.Filter({
                                        property: property + '.ObjectID',
                                        operator: '=',
                                        value: 0
                                    })];
                                }
                            }
                            else {
                                filters = filters.concat(currentLevelFilters);
                            }
                        }
                    }
                }
            }
        }

        // If building a hierarchy from top level down, we don't need to include filters
        // below the given type (e.g. a timeline app). Otherwise if being used for an app
        // that only displays one PI type, we need to include those lower filters
        if (includeFiltersBelowType) {
            let childFilter = await this._getChildFiltersForType(type, multiLevelFilters);
            if (childFilter) {
                filters.push(childFilter);
            }
        }

        return filters;
    },

    // Returns an array containing all of the filters applied to a specific PI level.
    // type is the TypeDefinition.TypePath for the Portfolio Item level you wish to fetch.
    getFiltersOfSingleType: async function (type) {
        let filters = [];
        let modelName = type.toLowerCase();
        let multiLevelFilters = this.getMultiLevelFilters();
        let keys = Object.keys(multiLevelFilters);

        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let val = multiLevelFilters[key];
            if (modelName === key.toLowerCase()) {
                await this._convertReleaseFilters(val);
                filters = filters.concat(val);
            }
        }

        return filters;
    },

    // Returns an object containing all of the filters applied in the multi-level
    // filter. Keys are the type definition field and the resulting values are arrays
    // of filters
    getMultiLevelFilters: function () {
        if (this._isSubscriber()) {
            return this.publishedValue.filters;
        }

        var filters = {};
        _.each(this.filterControls, function (filterControl) {
            let typeName = (filterControl.inlineFilterButton.modelNames) || 'unknown';
            filters[typeName] = filterControl.inlineFilterButton.getFilters();
        });

        return filters;
    },

    _getChildFiltersForType: async function (type, filters) {
        let idFilter;
        // PI types are in order lowest to highest
        for (let i = 0; i < this.portfolioItemTypes.length; i++) {
            let currentType = this.portfolioItemTypes[i].get('TypePath');
            if (currentType.toLowerCase() === type.toLowerCase()) {
                break;
            }
            if ((filters[currentType] && filters[currentType].length) || idFilter) {
                if (!filters[currentType]) {
                    filters[currentType] = [];
                }
                if (idFilter) {
                    filters[currentType].push(idFilter);
                }
                let records = await new Promise(function (resolve) { this._getFilteredIds(filters[currentType], currentType, resolve); }.bind(this));
                if (records.length) {
                    let parents = _.map(records, function (id) { return (id.get('Parent') && id.get('Parent').ObjectID) || 0; });
                    idFilter = new Rally.data.wsapi.Filter({
                        property: 'ObjectID',
                        operator: 'in',
                        value: _.uniq(parents)
                    });
                }
                else {
                    idFilter = new Rally.data.wsapi.Filter({
                        property: 'ObjectID',
                        operator: '=',
                        value: 0
                    });
                }
            }
        }
        return idFilter;
    },

    // removeInvalidFilters: function () {
    //     _.each(this.filterControls, function (filterControl) {
    //         filterControl.inlineFilterButton._removeInvalidFilters();
    //     }, this);
    // },

    // Takes an array of filters. If scoping across all projects, we need to update any release
    // filters to filter on the release name rather than the release value
    _convertReleaseFilters: async function (filters) {
        if (this.getIgnoreProjectScope()) {
            for (let i = 0; i < filters.length; i++) {
                if (filters[i].property === 'Release') {
                    let release = await this._getRelease(filters[i].value);
                    if (release) {
                        filters[i] = new Rally.data.wsapi.Filter({
                            property: 'Release.Name',
                            value: release.Name
                        });
                    }
                }
            }
        }
    },

    _getRelease: async function (releaseVal) {
        let deferred = Ext.create('Deft.Deferred');

        Ext.Ajax.request({
            url: Ext.String.format('/slm/webservice/v2.0{0}?fetch=Name', releaseVal),
            success(response) {
                if (response && response.responseText) {
                    let obj = Ext.JSON.decode(response.responseText);
                    if (obj && obj.Release) {
                        deferred.resolve(obj.Release);
                    }
                    else {
                        deferred.resolve(null);
                    }
                } else {
                    deferred.resolve(null);
                }
            }
        });

        return deferred.promise;
    },

    getSelectedPiRecord: function () {
        return this._getValue().piRecord;
    },

    getIgnoreProjectScope: function () {
        return this._getValue().ignoreProjectScope;
    },

    // Returns an object of states for all of the inline filters
    // Used for getting and setting shared views
    getMultiLevelFilterStates: function () {
        if (this._isSubscriber()) {
            return this.publishedValue.filterStates;
        }

        var states = {};
        _.each(this.filterControls, function (filterControl) {
            let typeName = (filterControl.inlineFilterButton.modelNames) || 'unknown';
            states[typeName] = filterControl.inlineFilterButton.getState();
        });

        return states;
    },

    getModels: function () {
        return this.models;
    },

    getPortfolioItemTypes: function () {
        return this.portfolioItemTypes;
    },

    // Sets the states of the inline filters
    // Used when applying a shared view to the filters
    setMultiLevelFilterStates: function (states) {
        if (!this._isSubscriber()) {
            this.tabPanel.removeAll();
            for (let key in states) {
                if (states.hasOwnProperty(key)) {
                    for (let i = 0; i < this.filterControls.length; i++) {
                        let typeName = (this.filterControls[i].inlineFilterButton.modelNames) || 'unknown';
                        if (typeName === key) {
                            this.filterControls[i].inlineFilterButton.applyState(states[key]);
                        }
                    }
                }
            }
            setTimeout(function () { this.tabPanel.setActiveTab(0); }.bind(this), 1500);
        }
    },

    // Returns an array of records fitting the given filters
    _getFilteredIds: function (filters, model, resolve) {
        let dataContext = Rally.getApp().getContext().getDataContext();
        if (this.getIgnoreProjectScope()) {
            dataContext.project = null;
        }

        let store = Ext.create('Rally.data.wsapi.Store', {
            autoLoad: false,
            context: dataContext,
            filters,
            model,
            fetch: ['ObjectID', 'Parent'],
            limit: Infinity
        });

        store.load().then({
            scope: this,
            success: function (records) {
                resolve(records);
            },
            failure: function () {
                Rally.ui.notify.Notifier.showError({ message: 'Multi-level filter failed while filtering out items below selected portfolio item type. Result set was probably too large.' });
                resolve([]);
            }
        });
    },

    _getLowestFilteredOrdinal: function () {

    },

    _setupPubSub: function () {
        if (this.publisher) {
            this.subscribe(this, 'registerChangeSubscriber', function (subscriberName) {
                // Register new unique subscribers
                if (!_.contains(this.changeSubscribers, subscriberName)) {
                    this.changeSubscribers.push(subscriberName);
                }
                this.publish(subscriberName, this._getValue());
            }, this);
            // Ask any existing subscribers to re-register
            this.publish('reRegisterChangeSubscriber');
        }
        else {
            this.subscriberEventName = Rally.getApp().getAppId() + this.$className;
            // Subscribe to a channel dedicated to this app
            this.subscribe(this, this.subscriberEventName, function (data) {
                if (this.intervalTimer) {
                    clearInterval(this.intervalTimer);
                    delete this.intervalTimer;
                }
                if (!this.isSubscriber) {
                    this.isSubscriber = true;
                    this._hideControlCmp();
                }
                this.publishedValue = data;

                // Default to an ancestor change event for backwards compatibility
                if (data.changeType === 'ancestor' || !data.changeType) {
                    this._onSelect();
                }
                else {
                    this._onChange();
                }
            }, this);
            // Attempt to register with a publisher (if one exists)
            this.publish('registerChangeSubscriber', this.subscriberEventName);
            this.intervalTimer = setInterval(function () {
                this.publish('registerChangeSubscriber', this.subscriberEventName);
            }.bind(this), 500);
            this.subscribe(this, 'reRegisterChangeSubscriber', function () {
                this.publish('registerChangeSubscriber', this.subscriberEventName);
            }, this);
        }
    },

    _getValue: function () {
        var result = {};
        if (this._isSubscriber()) {
            result = this.publishedValue || {};
        }
        else {
            if (this.piTypeSelector) {
                var selectedPiType = this.piTypeSelector.getRecord();
                if (selectedPiType && this.piSelector) {
                    var selectedPiTypePath = selectedPiType.get('TypePath');
                    var selectedRecord = this.piSelector.getRecord();
                    var selectedPi = this.piSelector.getValue();
                    _.merge(result, {
                        piTypePath: selectedPiTypePath,
                        isPiSelected: !!selectedRecord,
                        pi: selectedPi,
                        piRecord: selectedRecord
                    });
                }
            }
            result.ignoreProjectScope = this._ignoreProjectScope();
            result.filters = this.getMultiLevelFilters();
            result.filterStates = this.getMultiLevelFilterStates();
        }
        return result;
    },

    _setReady: function () {
        this._updateReleaseValues();

        this.ready = true;

        if (this._isSubscriber() && this.tabPanel) {
            this.tabPanel.hide();
        }

        if (this._isSubscriber() && this.showFiltersBtn) {
            this.showFiltersBtn.hide();
        }

        this.fireEvent('ready', this);
    },

    // Ancestor filter dropdowns have been selected
    _onSelect: function () {
        if (this.ready) {
            this.fireEvent('select', this);
        }
    },

    // Multi-level filters have changed
    _onChange: function () {
        if (this.ready) {
            this.fireEvent('change', this.getMultiLevelFilters());
        }
    },

    _getSettingsFields: function (fields) {
        var currentSettings = Rally.getApp().getSettings();
        if (!currentSettings.hasOwnProperty('Utils.AncestorPiAppFilter.projectScope')) {
            currentSettings['Utils.AncestorPiAppFilter.projectScope'] = 'user';
        }
        var pluginSettingsFields = [{
            xtype: 'rallycheckboxfield',
            id: 'Utils.AncestorPiAppFilter.enableAncestorPiFilter2',
            name: 'Utils.AncestorPiAppFilter.enableAncestorPiFilter2',
            fieldLabel: 'Filter artifacts by ancestor portfolio item',
        }, {
            xtype: 'rallyportfolioitemtypecombobox',
            id: 'Utils.AncestorPiAppFilter.defaultPiType',
            name: 'Utils.AncestorPiAppFilter.defaultPiType',
            fieldLabel: "Default Portfolio Item type",
            valueField: 'TypePath',
            allowNoEntry: false,
            defaultSelectionPosition: 'last',
            // Disable the preference enabled combo box plugin so that this control value is app specific
            plugins: []
        },
        {
            xtype: 'radiogroup',
            fieldLabel: 'Show artifacts from',
            columns: 1,
            vertical: true,
            allowBlank: false,
            items: [{
                boxLabel: "User's current project(s).",
                name: 'Utils.AncestorPiAppFilter.projectScope',
                inputValue: 'current',
                checked: 'current' === currentSettings['Utils.AncestorPiAppFilter.projectScope']
            }, {
                boxLabel: "All projects in workspace.",
                name: 'Utils.AncestorPiAppFilter.projectScope',
                inputValue: 'workspace',
                checked: 'workspace' === currentSettings['Utils.AncestorPiAppFilter.projectScope']
            }, {
                boxLabel: 'User selectable (either current project(s) or all projects in workspace).',
                name: 'Utils.AncestorPiAppFilter.projectScope',
                inputValue: 'user',
                checked: 'user' === currentSettings['Utils.AncestorPiAppFilter.projectScope']
            },],
            listeners: {
                scope: this,
                change: function () {
                    return;
                }
            }
        },
        {
            xtype: 'rallycheckboxfield',
            id: 'Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter',
            name: 'Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter',
            fieldLabel: 'Enable multi-level portfolio item filter',
        }
        ];
        pluginSettingsFields = _.map(pluginSettingsFields, function (pluginSettingsField) {
            return _.merge(pluginSettingsField, this.settingsConfig);
        }, this);
        // apply any settings config to each field added by the plugin
        return pluginSettingsFields.concat(fields || []);
    },

    // When changing projects, if a release filter was previously applied, the inline filter state remembers the release
    // filter, but fails to populate the comobobox with the release name, which becomes misleading to 
    // the end user. This hack finds the release name and shoves it into the combobox.
    _updateReleaseValues: function () {
        _.each(this.filterControls, function (filter) {
            _.each(filter.inlineFilterButton.inlineFilterPanel.advancedFilterPanel.advancedFilterRows.rows, function (row) {
                if (row.name === 'Release' && row._valueFieldIsValid()) {
                    _.each(row.items.items, function (rowItem) {
                        if (rowItem.xtype === 'rallyreleasecombobox') {
                            this._getRelease(rowItem.originalValue).then(function (release) {
                                if (release) {
                                    rowItem.rawValue = release.Name;
                                }
                            });
                        }
                    }, this);
                }
            }, this);
        }, this);
    },

    // Requires that app settings are available (e.g. from 'beforelaunch')
    _addAncestorControls: function () {
        var controlsLayout = {
            type: 'hbox',
            align: 'middle',
            defaultMargins: '0 10 0 0'
        };
        var ownerLabelWidth = this.ownerLabelWidth;
        if (this.cmp.getWidth() < this.singleRowMinWidth) {
            controlsLayout = 'vbox';
            ownerLabelWidth = this.ancestorLabelWidth;
        }
        var scopeControlByItself = false;
        if (this._showAncestorFilter() === false && this._showIgnoreProjectScopeControl() === true) {
            scopeControlByItself = true;
        }
        var controls = {
            xtype: 'container',
            id: 'controlsArea',
            overflowX: 'auto',
            layout: {
                type: 'hbox',
                align: 'top'
            },
            items: [{
                xtype: 'container',
                id: 'pubSubIndicatorArea',
                width: 25,
                padding: '6 5 0 0',
                hidden: !this.publisher && !this._isSubscriber(),
                items: [{
                    xtype: 'component',
                    id: 'publisherIndicator',
                    html: '<span class="icon-bullhorn icon-large"></span>',
                    hidden: !this.publisher
                },
                {
                    xtype: 'component',
                    id: 'subscriberIndicator',
                    html: '<span class="icon-link icon-large"></span>',
                    hidden: !this._isSubscriber()
                },
                ]
            }, {
                xtype: 'container',
                id: 'filtersArea',
                layout: controlsLayout,
                items: [{
                    xtype: 'container',
                    id: 'ancestorFilterArea',
                    layout: {
                        type: 'hbox',
                        align: 'middle'
                    },
                    items: [{
                        xtype: 'container',
                        id: 'piTypeArea',
                        layout: {
                            type: 'hbox',
                            align: 'middle'
                        },
                    },
                    {
                        xtype: 'container',
                        id: 'piSelectorArea',
                        layout: {
                            type: 'hbox',
                            align: 'middle',
                            padding: '0 0 0 5'
                        },
                    }
                    ]
                }, {
                    xtype: 'container',
                    itemId: 'scopeControlArea',
                    id: 'scopeControlArea',
                    width: 250,
                    layout: {
                        type: 'hbox',
                        align: 'middle'
                    },
                    items: [{
                        xtype: 'rallycombobox',
                        itemId: 'ignoreScopeControl',
                        id: 'ignoreScopeControl',
                        stateful: true,
                        stateId: this.cmp.getContext().getScopedStateId('Utils.AncestorPiAppFilter.ignoreProjectScopeControl'),
                        stateEvents: ['select'],
                        hidden: this._isSubscriber() || !this._showIgnoreProjectScopeControl(),
                        displayField: 'text',
                        valueField: 'value',
                        labelStyle: this.labelStyle,
                        labelWidth: ownerLabelWidth,
                        fieldLabel: scopeControlByItself ? this.ownerOnlyLabel : this.ownerLabel,
                        // Don't set initial value with this component or it will override the state
                        storeConfig: {
                            fields: ['text', 'value'],
                            data: [{
                                text: "Current Project(s)",
                                value: false
                            }, {
                                text: "Any Project",
                                value: true
                            }]
                        },
                        listeners: {
                            scope: this,
                            change: function () {
                                this._onSelect();
                            }
                        },
                    }]
                }]
            }]
        };

        if (this.renderArea) {
            // Without this, the components are clipped on narrow windows
            this.renderArea.setOverflowXY('auto', 'auto');
            this.renderArea.add(controls);
        }

        this._addTooltips();

        // Need to get pi types sorted by ordinal lowest to highest for the filter logic to work
        return new Promise(function (resolve) {
            if (!this._isSubscriber() && this._showAncestorFilter()) {
                // Now create the pi type selector
                this._addPiTypeSelector().then(function () {
                    this._addPiSelector(this.piTypeSelector.getValue(), null).then(
                        function () {
                            resolve();
                        }.bind(this)
                    );
                }.bind(this));
            }
            else {
                resolve();
            }
        }.bind(this));
    },

    _addPiTypeSelector: function (initialValue) {
        return new Promise(function (resolve) {
            this.piTypeSelector = Ext.create('Rally.ui.combobox.PortfolioItemTypeComboBox', {
                xtype: 'rallyportfolioitemtypecombobox',
                id: 'Utils.AncestorPiAppFilter.piType',
                name: 'Utils.AncestorPiAppFilter.piType',
                width: 250,
                // Disable the preference enabled combo box plugin so that this control value is app specific
                plugins: [],
                stateful: true,
                stateId: this.cmp.getContext().getScopedStateId('Utils.AncestorPiAppFilter.piType'),
                stateEvents: ['select'],
                fieldLabel: this.ancestorLabel,
                labelWidth: this.ancestorLabelWidth,
                labelStyle: this.labelStyle,
                valueField: 'TypePath',
                value: initialValue || this._defaultPortfolioItemType(),
                allowNoEntry: false,
                defaultSelectionPosition: 'first',
                listeners: {
                    scope: this,
                    ready: function (combobox) {
                        // Unfortunately we cannot use the combobox store of PI types for our filter
                        // logic because it is sorted by ordinal from highest to lowest so that the
                        // picker options have a an order familiar to the user.

                        // Don't add the change listener until ready. This prevents us
                        // from adding and removing the pi selector multiple times during
                        // startup which causes a null ptr exception in that component
                        combobox.addListener({
                            scope: this,
                            change: this._onPiTypeChange
                        });
                        resolve();
                    }
                }
            });
            this.renderArea.down('#piTypeArea').add(this.piTypeSelector);
        }.bind(this));
    },

    _addTooltips: function () {
        Ext.tip.QuickTipManager.register({
            target: 'publisherIndicator',
            text: 'This app broadcasts filter settings to any enabled ancestor filtered apps (indicated with <span class="icon-link icon-large"></span>)',
            showDelay: 50,
            border: true
        });

        Ext.tip.QuickTipManager.register({
            target: 'subscriberIndicator',
            text: 'This app listens for filter settings from any enabled ancestor filter broadcast app (indicated with <span class="icon-bullhorn icon-large"></span>)',
            showDelay: 50,
            border: true
        });

        if (this._isSubscriber()) {
            Ext.tip.QuickTipManager.register({
                target: 'subscriberFilterIndicator',
                text: 'This app listens for filter settings from any enabled ancestor filter broadcast app (indicated with <span class="icon-bullhorn icon-large"></span>)',
                showDelay: 50,
                border: true
            });
        }
    },

    _onCmpResize: function (cmp, width) {
        var controlsLayout = {
            type: 'hbox',
            align: 'middle',
            defaultMargins: '0 10 0 0'
        };
        if (width < this.singleRowMinWidth) {
            controlsLayout = {
                type: 'vbox'
            };
        }
        var filtersArea = this.renderArea.down('#filtersArea');
        if (filtersArea) {
            var controlsArea = this.renderArea.down('#controlsArea');
            var filters = filtersArea.removeAll(false);
            var newFiltersArea = {
                xtype: 'container',
                id: 'filtersArea',
                layout: controlsLayout,
                items: filters,
                hidden: filtersArea.isHidden()
            };
            controlsArea.remove(filtersArea, false);
            controlsArea.add(newFiltersArea);
        }
    },

    _hideControlCmp: function () {
        if (this.renderArea) {
            this.renderArea.down('#pubSubIndicatorArea').show();
            this.renderArea.down('#subscriberIndicator').show();
            this.renderArea.down('#filtersArea').hide();
        }
    },

    _onPiTypeChange: function (piTypeSelector, newValue) {
        if (newValue) {
            let currentPi = this._getValue().pi;
            this._removePiSelector();
            this._addPiSelector(newValue).then(
                function () {
                    this._setReady();
                    // If an ancestor was selected it has now been cleared, so fire select event
                    if (currentPi) {
                        this._onSelect();
                    }
                }.bind(this)
            );
        }
    },

    _removePiSelector: function () {
        this.renderArea.down('#piSelectorArea').removeAll(true);
    },

    _addPiSelector: function (piType, initialValue) {
        return new Promise(function (resolve) {
            this.piSelector = Ext.create('Rally.ui.combobox.ArtifactSearchComboBox', {
                id: 'Utils.AncestorPiAppFilter.piSelector',
                width: 250,
                labelAlign: 'top',
                storeConfig: {
                    models: piType,
                    autoLoad: true,
                    fetch: this.defaultFetch,
                    context: {
                        project: null
                    }
                },
                queryDelay: 7000,
                autoSelectCurrentItem: false,
                stateful: true,
                stateId: this.cmp.getContext().getScopedStateId('Utils.AncestorPiAppFilter.piSelector'),
                stateEvents: ['select'],
                valueField: '_ref',
                allowClear: true,
                clearValue: null,
                allowNoEntry: this.allowNoEntry,
                noEntryValue: '',
                value: initialValue || '',
                // forceSelection: false,
                defaultSelectionPosition: null,
                listeners: {
                    scope: this,
                    select: function () {
                        this._onSelect();
                    },
                    ready: function () {
                        resolve();
                    }
                }
            });
            // Allow this combobox to save null state (which is default behavior of
            // stateful mixin, but for some reason was overridden in combobox)
            Ext.override(this.piSelector, {
                saveState: function () {
                    var me = this,
                        id = me.stateful && me.getStateId(),
                        hasListeners = me.hasListeners,
                        state;

                    if (id) {
                        state = me.getState() || {}; //pass along for custom interactions
                        if (!hasListeners.beforestatesave || me.fireEvent('beforestatesave', me, state) !== false) {
                            Ext.state.Manager.set(id, state);
                            if (hasListeners.statesave) {
                                me.fireEvent('statesave', me, state);
                            }
                        }
                    }
                }
            });
            this.renderArea.down('#piSelectorArea').add(this.piSelector);
        }.bind(this));
    },

    _setPiSelector: function (piType, pi) {
        return new Promise(function (resolve) {
            this.piTypeSelector.suspendEvents(false);
            this.piTypeSelector.setValue(piType);
            this._removePiSelector();
            this._addPiSelector(piType, pi).then(function () {
                this.piSelector.setValue(pi);
                this.piTypeSelector.resumeEvents();
                resolve();
            }.bind(this));
        }.bind(this));
    },

    _showAncestorFilter: function () {
        return this.cmp.getSetting('Utils.AncestorPiAppFilter.enableAncestorPiFilter2');
    },

    _showIgnoreProjectScopeControl: function () {
        return this.cmp.getSetting('Utils.AncestorPiAppFilter.projectScope') === 'user';
    },

    _ignoreProjectScope: function () {
        if (this._isSubscriber()) {
            return this.publishedValue.ignoreProjectScope;
        }

        var result = false;
        if (this._showIgnoreProjectScopeControl()) {
            // If the control is shown, that values overrides the ignoreScope app setting
            result = this.renderArea.down('#ignoreScopeControl').getValue();
        }
        else if (this.cmp.getSetting('Utils.AncestorPiAppFilter.projectScope') === 'workspace') {
            result = true;
        }
        return result;
    },

    _isSubscriber: function () {
        return this.isSubscriber;
    },

    _defaultPortfolioItemType: function () {
        return this.cmp.getSetting('Utils.AncestorPiAppFilter.defaultPiType');
    },

    _propertyPrefix: function (typeName, piTypesAbove) {
        var property;
        if (typeName === 'hierarchicalrequirement' || typeName === 'userstory') {
            property = piTypesAbove[0].get('Name');
        }
        else if (typeName === 'defect') {
            property = 'Requirement.' + piTypesAbove[0].get('Name');
        }
        else if (Ext.String.startsWith(typeName, 'portfolioitem')) {
            property = 'Parent';
        }

        if (property) {
            // property already gets us to the lowest pi level above the current type
            // for each additional level, add a 'Parent' term, except for the last
            // type in the list which is the currently selected pi type ancestor
            _.forEach(piTypesAbove.slice(1), function () {
                property = property + '.Parent';
            }, this);
        }

        return property;
    },

    /**
     * Return a list of portfolio item types AT or below the selected pi type,
     * that are an ancestor of the given model, or null if there are no pi type
     * ancestors for the given model.
     */
    _piTypeAncestors: function (modelName, selectedPiTypePath) {
        var result = null;
        var selectedPiTypeIndex;
        var modelNamePiTypeIndex;

        if (_.contains(['hierarchicalrequirement', 'userstory', 'defect'], modelName)) {
            selectedPiTypeIndex = _.findIndex(this.portfolioItemTypes, function (piType) {
                return piType.get('TypePath').toLowerCase() === selectedPiTypePath.toLowerCase();
            });
            result = this.portfolioItemTypes.slice(0, selectedPiTypeIndex + 1);
        }
        else if (Ext.String.startsWith(modelName, 'portfolioitem')) {
            modelNamePiTypeIndex = _.findIndex(this.portfolioItemTypes, function (piType) {
                return piType.get('TypePath').toLowerCase() === modelName.toLowerCase();
            });
            selectedPiTypeIndex = _.findIndex(this.portfolioItemTypes, function (piType) {
                return piType.get('TypePath').toLowerCase() === selectedPiTypePath.toLowerCase();
            });

            if (modelNamePiTypeIndex < selectedPiTypeIndex) {
                // Don't include the current model pi in the list of ancestors
                // Include the selcted pi type ancestor
                result = this.portfolioItemTypes.slice(modelNamePiTypeIndex + 1, selectedPiTypeIndex + 1);
            }
        }

        return result;
    },

    /*
        Multi-Level Filter functions
    */
    _showMultiLevelFilter: function () {
        return this.cmp.getSetting('Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter');
    },

    _addFilters: function () {
        return new Promise(function (resolve, reject) {
            var promises = [];
            if (this._showMultiLevelFilter() && !this._isSubscriber()) {
                if (this.btnRenderArea) {
                    if (!this._isSubscriber()) {
                        this.showFiltersBtn = this.btnRenderArea.add(
                            {
                                xtype: 'rallybutton',
                                cls: this.filtersHidden ? 'secondary' : 'primary' + ' rly-small',
                                iconCls: 'icon-filter',
                                toolTipText: + this.filtersHidden ? 'Show' : 'Hide' + ' Filters',
                                handler: this._toggleFilters,
                                scope: this
                            }
                        );

                        var piTypePaths = _.map(this.portfolioItemTypes, function (piType) {
                            return piType.get('TypePath');
                        });
                        piTypePaths.reverse();

                        Rally.data.ModelFactory.getModels({
                            types: piTypePaths,
                            context: this.cmp.getContext(),
                            scope: this,
                            success: function (models) {
                                this.models = models;

                                this.tabPanel = this.panelRenderArea.add({
                                    xtype: 'tabpanel',
                                    width: '98%',
                                    cls: 'blue-tabs',
                                    minTabWidth: 100,
                                    plain: true,
                                    autoRender: true,
                                    hidden: this._isSubscriber(),
                                    hideMode: 'offsets',
                                    items: []
                                });

                                this.filterControls = [];

                                _.each(models, function (model, key) {
                                    promises.push(new Promise(function (newResolve) {
                                        let filterName = `inlineFilter${key}`;
                                        this.filterControls.push(Ext.create('Rally.ui.inlinefilter.InlineFilterControl', {
                                            xtype: 'rallyinlinefiltercontrol',
                                            name: filterName,
                                            autoRender: true,
                                            stateful: true,
                                            stateId: this.cmp.getContext().getScopedStateId(`multi-${filterName}-control`),
                                            itemId: filterName,
                                            context: this.cmp.getContext(),
                                            inlineFilterButtonConfig: {
                                                stateful: true,
                                                stateId: this.cmp.getContext().getScopedStateId(`multi-${filterName}`),
                                                context: this.cmp.getContext(),
                                                modelNames: key,
                                                filterChildren: this.filterChildren,
                                                inlineFilterPanelConfig: {
                                                    autoRender: true,
                                                    name: `${filterName}-panel`,
                                                    itemId: `${filterName}-panel`,
                                                    model: model,
                                                    padding: 5,
                                                    width: '98%',
                                                    context: this.cmp.getContext(),
                                                    quickFilterPanelConfig: {
                                                        defaultFields: this.defaultFilterFields,
                                                        addQuickFilterConfig: {
                                                            whiteListFields: this.whiteListFields,
                                                            blackListFields: this.blackListFields
                                                        }
                                                    },
                                                    advancedFilterPanelConfig: {
                                                        collapsed: this.advancedFilterCollapsed,
                                                        advancedFilterRowsConfig: {
                                                            propertyFieldConfig: {
                                                                blackListFields: this.blackListFields,
                                                                whiteListFields: this.whiteListFields
                                                            }
                                                        }
                                                    },
                                                },
                                                listeners: {
                                                    inlinefilterchange: this._onFilterChange,
                                                    inlinefilterready: function (panel) {
                                                        this._onFilterReady(panel);
                                                        newResolve();
                                                    },
                                                    scope: this
                                                }
                                            }
                                        }));
                                    }.bind(this)));
                                }, this);

                                Promise.all(promises).then(function () {
                                    if (!this._isSubscriber()) {
                                        this.clearAllButton = Ext.widget({
                                            xtype: 'rallybutton',
                                            itemId: 'clearAllButton',
                                            cls: 'secondary rly-small clear-all-filters-button',
                                            text: 'Clear All',
                                            margin: '3 9 3 0',
                                            hidden: !this._hasFilters(),
                                            listeners: {
                                                click: this._clearAllFilters,
                                                scope: this
                                            }
                                        });

                                        this.btnRenderArea.add(this.clearAllButton);
                                        this.tabPanel.setActiveTab(0);
                                        if (this.filtersHidden) {
                                            this.tabPanel.hide();
                                        }

                                        // Without this, the components are clipped on narrow windows
                                        this.btnRenderArea.setOverflowXY('auto', 'auto');
                                    }
                                    resolve();
                                }.bind(this));
                            },
                            failure: function () {
                                reject('Failed to fetch models for multi-level filter');
                            }
                        });
                    }
                    else {
                        this.btnRenderArea.add({
                            xtype: 'container',
                            id: 'filterSubIndicatorArea',
                            width: 25,
                            padding: '6 5 0 0',
                            items: [
                                {
                                    xtype: 'component',
                                    id: 'subscriberFilterIndicator',
                                    html: '<span class="icon-link icon-large"></span>'
                                }
                            ]
                        });
                        resolve();
                    }
                } else {
                    reject('Unable to find button render area for multi-level filter');
                }
            }
            else {
                resolve();
            }
        }.bind(this));
    },

    _clearAllFilters: function () {
        this.suspendEvents(false);
        this.suspendLayouts();

        // The quick filters don't properly clear if the filter isn't displayed
        let activeTab = this.tabPanel.getActiveTab();

        _.each(this.filterControls, function (filterControl) {
            try {
                this.tabPanel.setActiveTab(filterControl.tab);
                filterControl.inlineFilterButton.clearAllFilters();
            }
            catch (e) {
                console.log(e);
            }
        }.bind(this));

        this.tabPanel.setActiveTab(activeTab);

        if (this.clearAllButton) {
            this.clearAllButton.hide();
        }

        this.resumeEvents();
        this.resumeLayouts(false);
        this.updateLayout();
        this.fireEvent('change', this.getMultiLevelFilters());
    },

    _hasFilters: function () {
        var filters = this.getMultiLevelFilters();
        var returnVal = false;

        _.each(filters, function (filter) {
            if (filter.length) {
                returnVal = true;
            }
        });

        return returnVal;
    },

    _onFilterReady: function (panel) {
        panel.expand();
        let filterCount = panel.quickFilterPanel.getFilters().length + panel.advancedFilterPanel.getFilters().length;
        let modelName = (panel.model && panel.model.elementName) || 'unknown';

        let tab = this.tabPanel.add({
            title: modelName + (filterCount ? ` (${filterCount})` : ''),
            html: '',
            itemId: `${modelName}-tab`,

        });

        tab.add({
            xtype: 'container',
            layout: 'hbox',
            items: [panel]
        });

        panel.tab = tab;
    },

    _applyFilters: function () {
        this.suspendEvents(false);
        this.suspendLayouts();
        _.each(this.filterControls, function (filterControl) {
            filterControl.inlineFilterButton._applyFilters();
        });
        this.resumeEvents();
        this.resumeLayouts(false);
        this.updateLayout();
    },

    _onFilterChange: function () {
        if (this.clearAllButton) {
            if (this._hasFilters()) {
                this.clearAllButton.show();
            }
            else {
                this.clearAllButton.hide();
            }
        }

        _.each(this.filterControls, function (filterControl) {
            let typeName = (filterControl.inlineFilterButton.inlineFilterPanel.model.elementName) || 'unknown';
            this._setTabText(typeName, filterControl.inlineFilterButton.getFilters().length);
        }, this);

        if (this.ready) {
            this.fireEvent('change', this.getMultiLevelFilters());
        }
    },

    _setTabText: function (typeName, filterCount) {
        var titleText = filterCount ? `${typeName} (${filterCount})` : typeName;
        var tab = this.tabPanel.child(`#${typeName}-tab`);

        if (tab) { tab.setTitle(titleText); }
    },

    _toggleFilters: function (btn) {
        if (this.tabPanel.isHidden()) {
            this.tabPanel.show();
            btn.setToolTipText('Hide Filters');
            btn.addCls('primary');
            btn.removeCls('secondary');
        } else {
            this.tabPanel.hide();
            btn.setToolTipText('Show Filters');
            btn.addCls('secondary');
            btn.removeCls('primary');
        }
    }
});