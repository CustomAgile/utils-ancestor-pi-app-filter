/*
        TODO (AM) - Separate code into multiple smaller files
*/
Ext.override(Rally.ui.inlinefilter.FilterFieldFactory, {
    _getBaseEditorConfig: function (fieldDef, context, model) {
        if (fieldDef.name === "CreatedBy") {
            let editorConfig = {
                xtype: "rallyusersearchcombobox",
                fieldLabel: fieldDef.displayName,
                allowNoEntry: false,
                valueField: '_uuidRef',
                storeConfig: {
                    models: [fieldDef.attributeDefinition.AllowedValueType._refObjectName],
                    context: {
                        workspace: context.getDataContext().workspace,
                        project: null
                    }
                }
            };

            return editorConfig;
        }

        return this.callParent(arguments);
    }
});

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

Ext.define('Utils.AncestorPiAppFilter', {
    alias: 'plugin.UtilsAncestorPiAppFilter',
    version: "1.1.5",
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
        defaultFilterFields: ['Owner'],

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
        // this._addCancelLoad(); TODO - Future work
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
            },

            // Don't create the close buttons
            _createCloseButton: function () { }
        });

        // Add the control components then fire ready
        this._getTypeDefinitions().then({
            scope: this,
            success: function () {
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

    _getTypeDefinitions: function () {
        let def = Ext.create('Deft.Deferred');

        Rally.data.util.PortfolioItemHelper.getPortfolioItemTypes().then({
            scope: this,
            success: function (piTypes) {
                this.portfolioItemTypes = piTypes;

                Ext.create('Rally.data.wsapi.Store', {
                    model: Ext.identityFn('TypeDefinition'),
                    fetch: ['Name', 'Ordinal', 'TypePath'],
                    requester: this,
                    filters: [{ property: 'Name', value: 'Hierarchical Requirement' }]
                }).load({
                    scope: this,
                    callback: function (records, operation, success) {
                        if (success) {
                            if (records && records.length) {
                                this.storyType = records[0];
                                this.allTypes = [this.storyType].concat(this.portfolioItemTypes);
                                def.resolve();
                            }
                            else { def.reject(); }
                        }
                        else { def.reject(); }
                    }
                });
            },
            failure: function () {
                def.reject();
            }
        });

        return def.promise;
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
            var typesAbove = this._getAncestorTypeArray(modelName, selectedPiTypePath);
            if (selectedRecord && selectedPi !== null && typesAbove !== null) {
                var property = this._getPropertyPrefix(modelName, typesAbove);
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
    // multi-level filter as well as the selected ancestor PI if one is selected. 
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
        let keys = this._getAllTypePaths();
        let currentLevelIndex = _.findIndex(keys, function (currentType) {
            return currentType.toLowerCase() === modelName;
        });

        for (let i = currentLevelIndex;i < keys.length;i++) {
            let currentType = keys[i];
            let currentFilters = multiLevelFilters[currentType];

            if (currentFilters && currentFilters.length) {
                // If scoping all projects, filter releases by name instead of value
                await this._convertReleaseFilters(currentFilters);

                // If we're at the given level, just add the filters
                if (modelName === currentType.toLowerCase()) {
                    filters = filters.concat(currentFilters);
                }
                // If we're at a level above the given level, convert filters to fit given level
                else {
                    let parentFilters = await this._getParentFilters(modelName, currentType, currentFilters);
                    filters = filters.concat(parentFilters);
                }
            }
        }

        // If building a hierarchy from top level down, we don't need to include filters
        // below the given type (e.g. a timeline app). Otherwise if being used for an app
        // that only displays one PI type, we need to include those lower filters
        if (includeFiltersBelowType && Ext.String.startsWith(type.toLowerCase(), 'portfolioitem')) {
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

        for (let i = 0;i < keys.length;i++) {
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
            return this.publishedValue.filters || {};
        }

        var filters = {};
        if (this.filterControls) {
            _.each(this.filterControls, function (filterControl) {
                let typeName = (filterControl.inlineFilterButton.modelNames) || 'unknown';
                filters[typeName] = filterControl.inlineFilterButton.getFilters();
            });
        }
        return filters;
    },

    // Starting at the lowest PI type, get a list of IDs that fit the given filter. 
    // Traverse up the PI hierarchy until reaching the given type and return a list of IDs
    // for that type that fit all filters from below
    // Returns an array of object IDs
    _getChildFiltersForType: async function (type, filters) {
        let idFilter;
        let types = this._getAllTypePaths();

        // PI types are in order lowest to highest
        for (let i = 0;i < types.length;i++) {
            let currentType = types[i];
            let currentFilter = filters[currentType];
            if (currentType.toLowerCase() === type.toLowerCase()) {
                break;
            }
            if ((currentFilter && currentFilter.length) || idFilter) {
                if (!currentFilter) {
                    currentFilter = [];
                }
                if (idFilter) {
                    currentFilter.push(idFilter);
                }

                // To reduce the number of results returned, we include filters of higher level PI types
                for (let j = i + 1;j < types.length;j++) {
                    let parentType = types[j];
                    let parentFilters = filters[parentType];

                    if (parentFilters && parentFilters.length) {
                        let parentFiltersForType = await this._getParentFilters(currentType, parentType, parentFilters);
                        currentFilter = currentFilter.concat(parentFiltersForType);
                    }
                }

                let records = await new Promise(function (resolve, reject) {
                    this._getFilteredIds(currentFilter, currentType, resolve, reject);
                }.bind(this)).catch((e) => {
                    Rally.ui.notify.Notifier.showError({ message: e });
                    return new Rally.data.wsapi.Filter({
                        property: 'ObjectID',
                        operator: '=',
                        value: 0
                    });
                });

                if (records.length) {
                    let parents = _.map(records, function (id) {
                        return (id.get('Parent') && id.get('Parent').ObjectID) ||
                            (id.get('Feature') && id.get('Feature').ObjectID) || 0;
                    });

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

    // Given a type and a parent type and array of parent filters, convert the filters
    // to apply to the given type
    _getParentFilters: async function (type, parentType, parentFilters) {
        let typesAbove = this._getAncestorTypeArray(type, parentType);

        if (typesAbove !== null) {
            let parentProperty = this._getPropertyPrefix(type, typesAbove);
            if (parentProperty) {
                let currentLevelFilters = [];
                let hasCustomFieldFilters = this._hasCustomFilters(parentFilters);
                _.each(parentFilters, function (filter) {
                    let prop = filter.property;
                    if (!hasCustomFieldFilters) {
                        prop = `${parentProperty}.${prop}`;
                    }

                    currentLevelFilters.push(new Rally.data.wsapi.Filter({
                        property: prop,
                        operator: filter.operator,
                        value: filter.value
                    }));
                }.bind(this));

                // If filters on custom fields exist, lets get a list of IDs at that level and use those IDs as our filter
                if (hasCustomFieldFilters) {
                    let parentIDs = [];
                    try {
                        parentIDs = await new Promise(function (resolve, reject) { this._getFilteredIds(currentLevelFilters, parentType, resolve, reject); }.bind(this)).catch((e) => {
                            Rally.ui.notify.Notifier.showError({ message: e });
                            return new Rally.data.wsapi.Filter({
                                property: 'ObjectID',
                                operator: '=',
                                value: 0
                            });
                        });

                        if (parentIDs.length) {
                            return new Rally.data.wsapi.Filter({
                                property: parentProperty + '.ObjectID',
                                operator: 'in',
                                value: _.map(parentIDs, function (id) { return id.get('ObjectID'); })
                            });
                        }
                        else {
                            return new Rally.data.wsapi.Filter({
                                property: parentProperty + '.ObjectID',
                                operator: '=',
                                value: 0
                            });
                        }
                    }
                    catch (e) {
                        return [new Rally.data.wsapi.Filter({
                            property: parentProperty + '.ObjectID',
                            operator: '=',
                            value: 0
                        })];
                    }
                }
                else {
                    return currentLevelFilters;
                }
            }
        }
        return [];
    },

    _hasCustomFilters: function (filters) {
        for (let filter of filters) {
            // Rally has a hard time filtering on custom dropdown fields on parents (probably
            // not indexed) so we check to see if any are applied
            if (filter.property.indexOf('c_') !== -1 && typeof filter.value === 'string') {
                return true;
            }
        }
        return false;
    },

    // Takes an array of filters. If scoping across all projects, we need to update any release
    // filters to filter on the release name rather than the release value
    _convertReleaseFilters: async function (filters) {
        if (this.getIgnoreProjectScope()) {
            for (let i = 0;i < filters.length;i++) {
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

    getCurrentView: function () {
        var ancestorData = this._getValue();
        // Delete piRecord to avoid recursive stack overflow error
        delete ancestorData.piRecord;
        return ancestorData;
    },

    setCurrentView: function (view) {
        let scopeControl = this.renderArea.down('#ignoreScopeControl');
        if (scopeControl && typeof view.ignoreProjectScope === 'boolean') {
            scopeControl.suspendEvents(false);
            scopeControl.setValue(view.ignoreProjectScope);
            scopeControl.resumeEvents();
        }

        this.setMultiLevelFilterStates(view.filterStates);

        if (view.piTypePath) {
            this._setPiSelector(view.piTypePath, view.pi);
        }
    },

    // Returns an object of states for all of the inline filters
    // Used for getting and setting shared views
    getMultiLevelFilterStates: function () {
        if (this._isSubscriber()) {
            return this.publishedValue.filterStates || {};
        }

        var states = {};
        if (this.filterControls) {
            _.each(this.filterControls, function (filterControl) {
                let typeName = (filterControl.inlineFilterButton.modelNames) || 'unknown';
                states[typeName] = filterControl.inlineFilterButton.getState();
            });
        }

        return states;
    },

    getModels: function () {
        return this.models;
    },

    getPortfolioItemTypes: function () {
        return this.portfolioItemTypes;
    },

    getLowestPortfolioItemType: function () {
        return this.portfolioItemTypes[0];
    },

    // Sets the states of the inline filters
    // Used when applying a shared view to the filters
    setMultiLevelFilterStates: function (states) {
        if (!this._isSubscriber()) {
            if (states) {
                if (this.tabPanel) {
                    this.tabPanel.removeAll();
                }
                for (let key in states) {
                    if (states.hasOwnProperty(key)) {
                        for (let i = 0;i < this.filterControls.length;i++) {
                            let typeName = (this.filterControls[i].inlineFilterButton.modelNames) || 'unknown';
                            if (typeName === key) {
                                let filterBtn = this.filterControls[i].inlineFilterButton;
                                filterBtn.applyState(states[key]);
                            }
                        }
                    }
                }
                setTimeout(function () { this.tabPanel.setActiveTab(0); }.bind(this), 1500);
            }
            else {
                this._clearAllFilters();
            }
        }
    },

    // On many apps, the multilevel filter replaces the original single inline filter
    // control. Some users have saved views containing a filter state from this original
    // filter. This method allows apps to try and apply those filters to the multilevel
    // filter at the proper level in the porfolio hierarchy
    mergeLegacyFilter: function (multiFilterStates, legacyFilterState, modelName) {
        if (!this._isSubscriber() && multiFilterStates && legacyFilterState && modelName) {
            for (let multiModel in multiFilterStates) {
                if (multiFilterStates.hasOwnProperty(multiModel)) {
                    if (multiModel === modelName) {
                        try {
                            let currentState = multiFilterStates[multiModel];
                            if (legacyFilterState.matchType) {
                                currentState.matchType = legacyFilterState.matchType;
                            }
                            if (typeof legacyFilterState.condition === 'string') {
                                currentState.condition = legacyFilterState.condition;
                            }
                            if (legacyFilterState.quickFilters) {
                                currentState.quickFilters = _.merge(currentState.quickFilters, legacyFilterState.quickFilters);
                            }
                            if (legacyFilterState.advancedFilters) {
                                currentState.advancedFilters = _.merge(currentState.advancedFilters, legacyFilterState.advancedFilters);
                            }
                            if (legacyFilterState.quickFilterFields) {
                                currentState.quickFilterFields = _.merge(currentState.quickFilterFields, legacyFilterState.quickFilterFields);
                            }
                        }
                        catch (e) {
                            console.error('Failed to merge legacy filter into multi-level filter');
                        }
                    }
                }
            }
        }
    },

    // Returns an array of records fitting the given filters
    _getFilteredIds: async function (filters, model, resolve, reject) {
        let dataContext = Rally.getApp().getContext().getDataContext();
        if (this.getIgnoreProjectScope()) {
            dataContext.project = null;
        }

        let ancestor = this.getAncestorFilterForType(model);
        if (ancestor && ancestor.value) {
            filters.push(ancestor);
        }

        let fetch = ['ObjectID'];
        if (model === 'HierarchicalRequirement') {
            fetch.push('Feature');
        }
        else {
            fetch.push('Parent');
        }

        let totalCount = await this._getTotalResultCount(dataContext, filters, model);

        if (totalCount === -1) {
            reject('Multi-level filter failed while filtering out items above or below selected portfolio item type.');
        }
        else if (totalCount === 0) {
            resolve([]);
        }
        else if (totalCount > 6000) {
            reject('One of the filters is trying to return too many records and would result in long load times or timeouts, try using more specific filters to reduce the total result-set.');
        }
        else {
            let store = Ext.create('Rally.data.wsapi.Store', {
                autoLoad: false,
                context: dataContext,
                filters,
                model,
                fetch,
                limit: Infinity,
                enablePostGet: true
            });

            store.load().then({
                scope: this,
                success: function (records) {
                    resolve(records);
                },
                failure: function () {
                    reject('Multi-level filter failed while filtering out items above or below selected portfolio item type. Result set was probably too large.');
                }
            });
        }
    },

    _getTotalResultCount: function (context, filters, model) {
        let deferred = Ext.create('Deft.Deferred');

        let store = Ext.create('Rally.data.wsapi.Store', {
            autoLoad: false,
            context,
            filters,
            model,
            fetch: ['_ref'],
            limit: 1,
            enablePostGet: true
        });

        store.load().then({
            scope: this,
            success: function () {
                deferred.resolve(store.totalCount);
            },
            failure: function () {
                deferred.resolve(-1);
            }
        });

        return deferred.promise;
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

                if (this.ready) {
                    // Default to an ancestor change event for backwards compatibility
                    if (data.changeType === 'ancestor' || !data.changeType) {
                        this._onSelect();
                    }
                    else {
                        this._onChange();
                    }
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
                        isPiSelected: !!selectedPi,
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

        if (this._isSubscriber()) {
            if (this.tabPanel) {
                this.tabPanel.hide();
            }

            if (this._isSubscriber() && this.showFiltersBtn) {
                this.showFiltersBtn.hide();
            }

            if (this.renderArea.down('#filterHelpBtn')) {
                this.renderArea.down('#filterHelpBtn').hide();
            }

            if (!this.publishedValue.filters) {
                setTimeout(function () {
                    this.ready = true;
                    this.fireEvent('ready', this);
                }.bind(this), 800);
                return;
            }
        }
        this.ready = true;
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
                        itemId: 'piSelectorArea',
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
            this.renderArea.add({
                xtype: 'rallybutton',
                itemId: 'filterHelpBtn',
                cls: 'filter-help',
                iconOnly: true,
                iconCls: 'icon-help',
                hidden: this._isSubscriber() || !this._showMultiLevelFilter(),
                handler: (...args) => this.onHelpClicked(...args)
            });
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
                    // this._setReady();
                    // If an ancestor was selected it has now been cleared, so fire select event
                    if (currentPi) {
                        this._onSelect();
                    }
                }.bind(this)
            );
        }
    },

    _removePiSelector: function () {
        this.piSelector = null;
        this.renderArea.down('#piSelectorArea').removeAll(true);
    },

    _addPiSelector: function (piType, initialValue) {
        return new Promise(function (resolve) {
            this.piSelector = Ext.create('Rally.ui.combobox.ArtifactSearchComboBox', {
                id: 'Utils.AncestorPiAppFilter.piSelector',
                width: 250,
                margin: '0 10 0 10',
                labelAlign: 'top',
                storeConfig: {
                    models: piType,
                    autoLoad: true,
                    fetch: this.defaultFetch,
                    context: {
                        project: null
                    }
                },
                queryDelay: 2000,
                typeAhead: false,
                validateOnChange: false,
                stateful: true,
                stateId: this.cmp.getContext().getScopedStateId('Utils.AncestorPiAppFilter.piSelector'),
                stateEvents: ['select'],
                valueField: '_ref',
                allowClear: true,
                clearValue: null,
                allowNoEntry: this.allowNoEntry,
                noEntryValue: '',
                value: initialValue || null,
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
            if (this.piTypeSelector) {
                this.piTypeSelector.suspendEvents(false);
                this.piTypeSelector.setValue(piType);
                this._removePiSelector();
                this._addPiSelector(piType, pi).then(function () {
                    this.piSelector.setValue(pi);
                    this.piTypeSelector.resumeEvents();
                    resolve();
                }.bind(this));
            }
            else {
                resolve();
            }
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

    _getPropertyPrefix: function (typeName, typesAbove) {
        let type = typeName.toLowerCase();
        let property;

        if (type === 'hierarchicalrequirement' || type === 'userstory') {
            property = this.getLowestPortfolioItemType().get('Name');
        }
        else if (type === 'defect') {
            property = 'Requirement';
            typesAbove = typesAbove.slice(1);
            if (typesAbove.length) {
                property += `.${this.getLowestPortfolioItemType().get('Name')}`;
            }
        }
        else if (Ext.String.startsWith(type, 'portfolioitem')) {
            property = 'Parent';
        }

        if (property) {
            // property already gets us to the lowest pi level above the current type
            // for each additional level, add a 'Parent' term, except for the last
            // type in the list which is the currently selected pi type ancestor
            _.forEach(typesAbove.slice(1), function () {
                property += '.Parent';
            }, this);
        }

        return property;
    },

    /**
     * Return a list of artifact types AT or below the selected artifact type,
     * that are an ancestor of the given model, or null if there are no pi type
     * ancestors for the given model.
     */
    _getAncestorTypeArray: function (modelName, selectedPiTypePath) {
        var selectedPiTypeIndex;
        var modelNamePiTypeIndex;
        var model = modelName.toLowerCase();
        var selectedModel = selectedPiTypePath.toLowerCase();

        if (model === 'defect') {
            selectedPiTypeIndex = _.findIndex(this.allTypes, function (type) {
                return type.get('TypePath').toLowerCase() === selectedModel;
            });
            return this.allTypes.slice(0, selectedPiTypeIndex + 1);
        }

        modelNamePiTypeIndex = _.findIndex(this.allTypes, function (type) {
            return type.get('TypePath').toLowerCase() === model;
        });
        selectedPiTypeIndex = _.findIndex(this.allTypes, function (type) {
            return type.get('TypePath').toLowerCase() === selectedModel;
        });

        if (modelNamePiTypeIndex < selectedPiTypeIndex) {
            // Don't include the current model pi in the list of ancestors
            // Include the selcted pi type ancestor
            return this.allTypes.slice(modelNamePiTypeIndex + 1, selectedPiTypeIndex + 1);
        }

        return null;
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
                                xtype: 'multifiltertogglebtn',
                                cls: ' rly-small',
                                handler: this._toggleFilters,
                                scope: this,
                                stateId: this.cmp.getContext().getScopedStateId(`multi-filter-toggle-button`),
                                listeners: {
                                    added: function (btn) {
                                        if (btn.filtersHidden) {
                                            btn.addCls('secondary');
                                            btn.setToolTipText('Show Filters');
                                        }
                                        else {
                                            btn.addCls('primary');
                                            btn.setToolTipText('Hide Filters');
                                        }
                                    }
                                }
                            }
                        );

                        Rally.data.ModelFactory.getModels({
                            types: this._getAllTypePaths().reverse(),
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
                                    hidden: this._isSubscriber() || this.showFiltersBtn.filtersHidden,
                                    hideMode: 'offsets',
                                    items: []
                                });

                                this.filterControls = [];
                                let clearAdvancedButtonConfig = {};
                                let matchTypeConfig = {};
                                let advancedFilterRowsFlex = 1;
                                let propertyFieldConfig = {
                                    blackListFields: this.blackListFields,
                                    whiteListFields: this.whiteListFields
                                };
                                let context = this.cmp.getContext();

                                if (this.cmp.getWidth() < this.singleRowMinWidth) {
                                    clearAdvancedButtonConfig = {
                                        text: 'Clear'
                                    };
                                    matchTypeConfig = {
                                        fieldLabel: 'Match',
                                        width: 65
                                    };
                                    propertyFieldConfig.width = 100;
                                    advancedFilterRowsFlex = 2;
                                }

                                _.each(models, function (model, key) {
                                    promises.push(new Promise(function (newResolve) {
                                        let filterName = `inlineFilter${key}`;
                                        this.filterControls.push(Ext.create('Rally.ui.inlinefilter.InlineFilterControl', {
                                            xtype: 'rallyinlinefiltercontrol',
                                            name: filterName,
                                            autoRender: true,
                                            itemId: filterName,
                                            context,
                                            inlineFilterButtonConfig: {
                                                stateful: true,
                                                stateId: this.cmp.getContext().getScopedStateId(`multi-${filterName}-button`),
                                                stateEvents: ['inlinefilterchange'],
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
                                                    context,
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
                                                            propertyFieldConfig,
                                                            flex: advancedFilterRowsFlex
                                                        },
                                                        matchTypeConfig,
                                                        clearAdvancedButtonConfig
                                                    }
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
        let modelName = this._getModelName(panel);

        let tab = this.tabPanel.add({
            title: modelName + (filterCount ? ` (${filterCount})` : ''),
            html: '',
            itemId: `${modelName.replace(/\s+/g, '')}-tab`,

        });

        tab.add({
            xtype: 'container',
            layout: 'hbox',
            items: [panel]
        });

        panel.tab = tab;
    },

    _getModelName(panel) {
        let modelName = (panel.model && panel.model.elementName) || 'unknown';

        if (modelName === 'HierarchicalRequirement') {
            modelName = panel.model.displayName;
        }

        return modelName;
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
            let modelName = this._getModelName(filterControl.inlineFilterButton.inlineFilterPanel);
            this._setTabText(modelName, filterControl.inlineFilterButton.getFilters().length);
        }, this);

        if (this.ready) {
            this.fireEvent('change', this.getMultiLevelFilters());
        }
    },

    _setTabText: function (typeName, filterCount) {
        var titleText = filterCount ? `${typeName} (${filterCount})` : typeName;
        var tab = this.tabPanel.child(`#${typeName.replace(/\s+/g, '')}-tab`);

        if (tab) { tab.setTitle(titleText); }
    },

    _toggleFilters: function (btn) {
        if (this.tabPanel.isHidden()) {
            this.tabPanel.show();
            btn.setToolTipText('Hide Filters');
            btn.addCls('primary');
            btn.removeCls('secondary');
            btn.setFiltersHidden(false);
        } else {
            this.tabPanel.hide();
            btn.setToolTipText('Show Filters');
            btn.addCls('secondary');
            btn.removeCls('primary');
            btn.setFiltersHidden(true);
        }
    },

    _getAllTypePaths: function () {
        return _.map(this.allTypes, (type) => {
            return type.get('TypePath');
        });
    },

    /**
    *   Overrides to allow a store load to be canceled which will abort loading
    *   any subsequent pages and not invoke the load callback.
    */

    /*     TODO - Future work
 
     _addCancelLoad() {
 
         Ext.override(Rally.data.PageableStore, {
 
             loadCanceled: false,
 
             cancelLoad: function () {
                 this.loadCanceled = true;
             },
 
             load: function (options) {
                 this.loadCanceled = false;
                 this.callParent(arguments);
             },
 
             _shouldLoadMorePages: function (operation) {
                 if (this.loadCanceled) {
                     return false;
                 }
                 else {
                     return this.callParent(arguments)
                 }
             },
 
             _afterDoneLoadingAllPages: function (operation, success, callback, scope) {
                 if (this.loadCanceled) {
                     // Loading canceled. Don't send any events or invoke the callback
                     this.resumeEvents();
                     this.currentPage = 1;
                     this.loading = false;
                 }
                 else {
                     this.callParent(arguments);
                 }
             }
         });
     },
 
     */

    onHelpClicked() {
        let img = 'data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABkAAD/4QMtaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjMtYzAxMSA2Ni4xNDU2NjEsIDIwMTIvMDIvMDYtMTQ6NTY6MjcgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjUxOUIyN0ZBMDNERDExRUE4ODQ2QjE4NUUwOUYxOTBGIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjUxOUIyN0Y5MDNERDExRUE4ODQ2QjE4NUUwOUYxOTBGIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCBDUzYgKE1hY2ludG9zaCkiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmRpZDowMTgwMTE3NDA3MjA2ODExODA4Mzg5QkUyOEJBNDdENiIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDowMTgwMTE3NDA3MjA2ODExODA4Mzg5QkUyOEJBNDdENiIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/Pv/uAA5BZG9iZQBkwAAAAAH/2wCEAAEBAQEBAQEBAQEBAQEBAQEB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KmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OkS73nrlNQDipj86RLveeuU1AOKmPzpEu9565TUA4qY/OcS73nrlNQHsWVLvnOK7PR/wCYHjZ9n/rJe9ATZZUp9FxjP2d1jdrfxyAVATxZcj9FdHtn2GZzt/G+CoCeLA/cFhK2P7Fwtjhb+Dou16AnywPHQEqa7+nuIFYf+U4ioCZCFw2X3j0O3ZfdvZIotbbs4Nturb+jQFyUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoDAOS/zrx3+m0d/KpFAZglX5sSP8QvH5PUUBMMH4CZfxS3f2MmgKtQGGYz+CR/j6X/AN7nygK9QCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKA9Qd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AuxFjHIRO7xmRchHdD/KzaTj9kbpe96Au5DApmVwmzWZGf8A5sofjPR9HfX3oC5yYnJgkmAFJ5IIYijA2EJ/dRCsIQL2CIIrq7isK1+G17cNr0BmygFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAQuGwrbL2te32aA8+JK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxBXvLez7dAOIK95b2fboBxJVugC3r39ugPriwe9t7N/470A4sHvbUBHcD6Xs3oBuB9L2b+3QH1QCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUAoBQCgFAKAUB/9k=';
        let html = `
        <h3>This component enables filters to be applied to user stories and all portfolio item levels, regardless of the artifact 
        type(s) displayed in the app.</h3>

        <h3><b>Note:</b> For grid apps that allow expanding individual rows to see child artifacts, these filters are only applied to the top-level artifact type. 
        Child artifacts will not be filtered.</h3>
       
        <div><img src="${img}" alt="Multi-Level Filter Help" style="width:500px;display:block;margin-left:auto;margin-right:auto" /></div>
        
        <h3>Broadcaster/Listener Indicator</h3>
        <p>If present, this bullhorn icon indicates that the app is broadcasting the selected filters to any apps on the page
         that are listening for filter changes. If the icon is a chain link, it indicates that the app is listening to changes 
         made by a broadcasting app on the page.</p> 
        
        <h3>Scope Control</h3>
        <p>This dropdown controls whether the filters and resulting data will be scoped to the current project (Obeying the user's 
        Project Scope Down and Project Scope Up settings) or scoped across all projects within the workspace. Depending upon the app 
        and the filters, scoping across all projects may result in performance issues or timeout errors from the server. To ensure 
        timely performance, use filters that will return a manageable number of results.</p>

        <h3>Hide/Clear/Apply Filter Buttons</h3>
        
        <ul class="filter-help-list">
        <li><b>Show/Hide Filters: </b>Used to toggle the visibility of the filter controls. Use this to hide the filters if they're 
        not needed or more space is needed within the app</li>
        
        <li><b>Clear Filters: </b>This button will clear all of the quick filters and advanced filters across all artifact types. 
        Upon clearing the filters, the app will refresh its data.</li>
        
        <li><b>Apply Filters: </b>If present, this button becomes active after a single change is made to one of the filters. This button 
        allows the user to make multiple changes without the app refreshing after each change. Once the user has modified all of 
        the necessary filters, clicking this button will apply it to the app and refresh the data. If this button is not present, 
        the app will refresh after each change made to the filters.</li>
        </ul>

        <h3>Artifact Type Tabs</h3>
        <p>Each tab contains a unique filter that will apply filters to the artifact type specified within the tab title. 
        If the tab title ends with a number in parenthesis, this indicates the number of filters applied to that artifact type.</p>

        <h3>Errors</h3>
        <h4><i>One of the filters is trying to return too many records and would result in timeouts...</i></h4>
        <ul>
        <li>Often times, when using filters on artifact types above or below the artifact type displayed within the app, it's necessary 
        to first fetch those artifacts at that level in order to properly apply the filters. If the number of artifacts fitting those 
        filters is too large, it's too slow or impossible to retrieve all of them in order to then use them as filters afterwards.
        <br><br>
        <b>Example: </b>
        Using a grid to display Features across all projects. We only want to see Features that have User Stories that are blocked. 
        Since there's no way to directly search for Features containing blocked stories, we must first find all blocked stories so we can 
        build a list of Features that are tied to those stories. And since we're scoping across all projects, we must query for all blocked 
        stories across the workspace. The results would be over ten thousand records, which would take many minutes to load, or would fail 
        to load due to timeout errors. This is an example of when we would see this error. More specific filters, or scoping to a specific 
        project hierarchy would solve this issue.
        </li>
        </ul>
        `;

        Ext.create('Rally.ui.dialog.Dialog', {
            autoShow: true,
            layout: 'fit',
            width: '80%',
            height: '90%',
            closable: true,
            autoDestroy: true,
            autoScroll: true,
            title: 'Using The Multi-Level Filter',
            items: {
                xtype: 'component',
                html,
                padding: 15
            }
        });
    }
});