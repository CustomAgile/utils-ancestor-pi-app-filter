Ext.define('Utils.AncestorPiAppFilter', {
    alias: 'plugin.UtilsAncestorPiAppFilter',
    version: "1.3.2",
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
         * Set to true to show multilevel filter by default
         */
        displayMultiLevelFilter: false,

        /**
         * @cfg {String}
         * Choose default setting for project scope
         * Possible values: current, workspace, user
         */
        projectScope: 'user',

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
         * Whitelist array for inline filters. Used if app fails to retrieve global
         * whitelist or overrideGlobalWhitelist is set to true
         */
        whiteListFields: ['Tags', 'Milestones', 'c_EAEpic', 'DisplayColor'],

        /**
         * @cfg {Boolean}
         * Set to true to specify custom whitelist array
         */
        overrideGlobalWhitelist: false,

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
        defaultFilterFields: [],

        /**
         * @cfg {Boolean}
         * Set to true to hide filters on load
         */
        filtersHidden: false,

        /**
         * @cfg {Boolean}
         * Set to true to hide advanced filters on load
         */
        advancedFilterCollapsed: false,
        /**
         * @cfg {String}
         * Pass a typePath to set that PI type as the default visible tab
         */
        visibleTab: undefined,

        /**
         * @cfg {Boolean}
         * Set to true to prevent user from scoping app across the workspace
         * */
        disableGlobalScope: false
    },
    filterControls: [],
    portfolioItemTypes: [],
    readyDeferred: null,
    piTypesDeferred: null,
    isSubscriber: false,
    changeSubscribers: [],
    publishedValue: {},
    defaultTab: 0,

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
        this.renderArea = this.cmp.down('#' + this.renderAreaId);
        this.btnRenderArea = this.cmp.down('#' + this.btnRenderAreaId);
        this.panelRenderArea = this.cmp.down('#' + this.panelRenderAreaId);

        // Extend app settings fields
        var cmpGetSettingsFields = this.cmp.getSettingsFields;
        this.cmp.getSettingsFields = function () {
            return this._getSettingsFields(cmpGetSettingsFields.apply(cmp, arguments));
        }.bind(this);

        // Extend app default settings fields
        var appDefaults = this.cmp.defaultSettings;
        appDefaults['Utils.AncestorPiAppFilter.enableAncestorPiFilter2'] = false;
        appDefaults['Utils.AncestorPiAppFilter.projectScope'] = this.projectScope;
        appDefaults['Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter'] = this.displayMultiLevelFilter;
        this.cmp.setDefaultSettings(appDefaults);

        // Add the control components then fire ready
        this._getGlobalWhitelist().then({
            scope: this,
            success: function (whitelist) {
                this.whiteListFields = whitelist;

                this._getTypeDefinitions().then({
                    scope: this,
                    success: function () {
                        Promise.all([this._addAncestorControls(), this._addFilters()]).then(
                            function () {
                                setTimeout(function () { this._setReady(); }.bind(this), 500);
                            }.bind(this),
                            function (error) {
                                this._showError(error, 'Failed while adding ancestor and multilevel filters');
                                this._setReady();
                            }.bind(this)
                        );
                    },
                    failure: function () {
                        this._showError('Failed to fetch portfolio item types for multi-level filter');
                    }
                });
            }
        });
    },

    // Attempt to load preference object specifying list of fields to whitelist
    _getGlobalWhitelist: function () {
        let def = Ext.create('Deft.Deferred');
        let prefName = 'multi-level-filter-whitelist-fields-preference-' + this.cmp.getContext().getWorkspaceRef();
        if (this.overrideGlobalWhitelist) {
            def.resolve(this.whiteListFields);
            return def.promise;
        }

        Rally.data.PreferenceManager.load({
            filterByName: prefName,
            success: function (pref) {
                if (pref && pref.hasOwnProperty(prefName)) {
                    try {
                        let fields = pref[prefName].split(',');
                        if (fields && fields.length) {
                            def.resolve(fields);
                        }
                        else {
                            def.resolve(this.whiteListFields);
                        }
                    }
                    catch (e) {
                        def.resolve(this.whiteListFields);
                    }
                }
                else {
                    def.resolve(this.whiteListFields);
                }
            }
        });
        return def.promise;
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

        if (!multiLevelFilters || !Object.keys(multiLevelFilters).length) {
            return filters;
        }

        let keys = this._getAllTypePaths();
        let currentLevelIndex = _.findIndex(keys, function (currentType) {
            return currentType.toLowerCase() === modelName;
        });

        for (let i = currentLevelIndex; i < keys.length; i++) {
            let currentType = keys[i];
            let currentFilters = multiLevelFilters[currentType];

            if (currentFilters && currentFilters.length) {
                // If scoping all projects, filter releases by name instead of value
                // await this._convertReleaseFilters(currentFilters);

                // If we're at the given level, just add the filters
                if (modelName === currentType.toLowerCase()) {
                    filters = filters.concat(this._getWsapiFilter(modelName));
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
            let childFilters = this._getChildFiltersForType(type);
            if (childFilters) {
                filters = filters.concat(childFilters);
            }
        }

        return filters;
    },

    // Returns an array containing all of the filters applied to a specific PI level.
    // type is the TypeDefinition.TypePath for the Portfolio Item level you wish to fetch.
    getFiltersOfSingleType: async function (type) {
        return this._getWsapiFilter(type);
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

    getMultiLevelWsapiFilters: function () {
        if (this._isSubscriber()) {
            return this.publishedValue.wsapiFilters || {};
        }

        var filters = {};
        if (this.filterControls) {
            _.each(this.filterControls, function (filterControl) {
                let typeName = (filterControl.inlineFilterButton.modelNames) || 'unknown';
                filters[typeName] = filterControl.inlineFilterButton.getWsapiFilter();
            });
        }
        return filters;
    },

    // Return array of filters for all child levels below given type prefixed 
    // appropriately to filter at the given type
    _getChildFiltersForType: function (type) {
        let types = this._getAllTypePaths();
        let childProperty = '';
        let childFilters = [];

        let startIndex = _.findIndex(types, function (t) {
            return t.toLowerCase() === type.toLowerCase();
        });

        // Types are in order lowest to highest
        for (let i = startIndex - 1; i >= 0; i--) {
            let currentType = types[i];
            childProperty = childProperty + (childProperty.length ? '.' : '') + (currentType.toLowerCase() === 'hierarchicalrequirement' ? 'UserStories' : 'Children');
            childFilters = childFilters.concat(this._getWsapiFilter(currentType, childProperty));
        }

        return childFilters;
    },

    // Given a type, a parent type and array of parent filters, convert the filters
    // to apply to the given type
    // E.g.  (owner = /user/12345)   ->    (parent.parent.owner = /user/12345)
    _getParentFilters: async function (type, parentType, parentFilters) {
        let typesAbove = this._getAncestorTypeArray(type, parentType);

        if (typesAbove !== null) {
            let parentProperty = this._getPropertyPrefix(type, typesAbove);

            if (parentProperty) {
                let hasCustomFieldFilters = this._hasCustomFilters(parentFilters);
                let emptyFilter = [new Rally.data.wsapi.Filter({
                    property: parentProperty + '.ObjectID',
                    operator: '=',
                    value: 0
                })];

                // If filters on custom fields exist, lets get a list of IDs at that level and use those IDs as our filter
                // This is to overcome an issue with missing indices in Rally's database causing timeouts
                if (hasCustomFieldFilters && this.getIgnoreProjectScope()) {
                    let parentIDs = [];
                    try {
                        let currentLevelFilters = this._getWsapiFilter(parentType);
                        parentIDs = await new Promise(function (resolve, reject) { this._getFilteredRecords(currentLevelFilters, parentType, resolve, reject); }.bind(this)).catch((e) => {
                            this._showError(e, 'Failed while loading filters for parent artifacts');
                            return [];
                        });

                        if (parentIDs && parentIDs.length) {
                            return [new Rally.data.wsapi.Filter({
                                property: parentProperty + '.ObjectID',
                                operator: 'in',
                                value: _.map(parentIDs, function (id) { return id.get('ObjectID'); })
                            })];
                        }
                        else {
                            return emptyFilter;
                        }
                    }
                    catch (e) {
                        this._showError(e, 'Failed while loading filters for parent artifacts');
                        return emptyFilter;
                    }
                }
                else {
                    return this._getWsapiFilter(parentType, parentProperty);
                }
            }
        }
        return [];
    },

    // A user can apply a custom match condition to a set of inline filters.
    // This method returns the proper WSAPI filter object representing that
    // custom set of conditions. If parentPrefix is passed, the prefix is added to
    // the set of filters before returning
    _getWsapiFilter: function (model, parentPrefix) {
        let filter;
        if (this._isSubscriber()) {
            if (this.publishedValue.wsapiFilters) {
                for (let key in this.publishedValue.wsapiFilters) {
                    if (key.toLowerCase() === model.toLowerCase()) {
                        filter = this.publishedValue.wsapiFilters[key];
                        if (filter) {
                            filter = filter.clone();
                        }
                        break;
                    }
                }
            }
        }
        else {
            if (this.filterControls) {
                _.each(this.filterControls, function (filterControl) {
                    let typeName = filterControl.inlineFilterButton.modelNames || 'unknown';
                    if (typeName.toLowerCase() === model.toLowerCase()) {
                        filter = filterControl.inlineFilterButton.getWsapiFilter();
                        if (filter) {
                            filter = filter.clone();
                        }
                    }
                });
            }
        }

        if (filter) {
            this._updateWsapiDisplayColorFilter(filter);
            if (parentPrefix) {
                this._updateWsapiFilterWithPrefix(filter, parentPrefix);
            }
        }

        return filter ? [filter] : [];
    },

    // DisplayColor filter passes hex value as uppercase, but the web service needs
    // hex values to be lowercase in order to work properly
    _updateWsapiDisplayColorFilter: function (filter) {
        if (filter) {
            if (filter.property) {
                if (typeof filter.property === 'object') {
                    this._updateWsapiDisplayColorFilter(filter.property);
                }
            }

            if (typeof filter.value === 'object') {
                this._updateWsapiDisplayColorFilter(filter.value);
            }
            else if (typeof filter.value === 'string' && /^#[0-9a-f]{3,6}$/i.test(filter.value)) {
                filter.value = filter.value.toLowerCase();
            }
        }
    },

    // Recursively traverse through a Rally WSAPI filter and apply the given prefix to all of the values
    _updateWsapiFilterWithPrefix: function (filter, parentPrefix) {
        if (filter) {
            if (filter.property) {
                if (typeof filter.property === 'string') {
                    if (filter.config && filter.property === filter.config.property) {
                        filter.config.property = `${parentPrefix}.${filter.property}`;
                    }
                    if (filter.initialConfig && filter.property === filter.initialConfig.property) {
                        filter.initialConfig.property = `${parentPrefix}.${filter.property}`;
                    }
                    filter.property = `${parentPrefix}.${filter.property}`;
                }
                else {
                    this._updateWsapiFilterWithPrefix(filter.property, parentPrefix);
                }
            }

            if (typeof filter.value === 'object') {
                this._updateWsapiFilterWithPrefix(filter.value, parentPrefix);
            }
        }
    },

    // Rally has a hard time filtering on custom dropdown fields on parents (probably
    // not indexed) so we check to see if any are applied
    _hasCustomFilters: function (filters) {
        for (let filter of filters) {
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
        return !this.disableGlobalScope && this._getValue().ignoreProjectScope;
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
                this.suspendEvents(false);
                if (this.tabPanel) {
                    this.tabPanel.removeAll();
                }
                for (let key in states) {
                    if (states.hasOwnProperty(key)) {
                        for (let i = 0; i < this.filterControls.length; i++) {
                            let typeName = (this.filterControls[i].inlineFilterButton.modelNames) || 'unknown';
                            if (typeName === key) {
                                let filterBtn = this.filterControls[i].inlineFilterButton;
                                // filterBtn.suspendEvents(false);
                                filterBtn.applyState(states[key]);
                                // filterBtn.resumeEvents();
                            }
                        }
                    }
                }
                setTimeout(function () {
                    this.resumeEvents();
                    this.tabPanel && this.tabPanel.setActiveTab(this.defaultTab);
                    this._onChange();
                }.bind(this), 1500);
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
    mergeLegacyFilter: function (multiFilterStates, legacyFilterState, modelName, setState) {
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
                                if (legacyFilterState.quickFilterFields && !legacyFilterState.quickFilterFields.length) {
                                    for (let qFilter of legacyFilterState.quickFilters) {
                                        legacyFilterState.quickFilterFields.push(qFilter.name);
                                    }
                                }
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

            if (setState) {
                this.setMultiLevelFilterStates(multiFilterStates);
            }
        }
    },

    // Returns an array of records fitting the given filters
    _getFilteredRecords: async function (filters, model, resolve, reject) {
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

                // We only want to refresh the app if we have all of the filters from the broadcaster
                if (data.ready) {
                    this.publishedValue = data;
                    // Default to an ancestor change event for backwards compatibility
                    if (data.changeType === 'ancestor' || !data.changeType) {
                        this._onSelect();
                    }
                    else {
                        this._onChange();
                    }
                } else {
                    setTimeout(() => { this.publish('registerChangeSubscriber', this.subscriberEventName); }, 500);
                }
            }, this);

            // Attempt to register with a publisher (if one exists)
            this.publish('registerChangeSubscriber', this.subscriberEventName);
            this.registerAttempts = 0;
            this.intervalTimer = setInterval(() => {
                this.registerAttempts++;

                // After 15 attempts, there probably isn't a broadcaster present, so delete the interval
                if (this.registerAttempts >= 15) {
                    clearInterval(this.intervalTimer);
                    delete this.intervalTimer;
                    delete this.registerAttempts;
                }
                else {
                    this.publish('registerChangeSubscriber', this.subscriberEventName);
                }
            }, 500);
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
            result.wsapiFilters = this.getMultiLevelWsapiFilters();
            result.ready = this.ready;
        }
        return result;
    },

    _setReady: function () {
        // Hide floating components because of course they are still visible when settings menu is shown
        this.cmp.on('beforehide', () => {
            if (this.filterHelpBtn) {
                this.filterHelpBtn.hide();
            }
        });
        this.cmp.on('beforeshow', () => {
            if (this.filterHelpBtn) {
                this.filterHelpBtn.show();
            }
        });

        if (!this._showMultiLevelFilter() && this.filterHelpBtn) {
            this.filterHelpBtn.hide();
        }

        if (this._isSubscriber()) {
            if (this.tabPanel) {
                this.tabPanel.hide();
            }

            if (this.showFiltersBtn) {
                this.showFiltersBtn.hide();
            }

            if (this.filterHelpBtn) {
                this.filterHelpBtn.hide();
            }

            if (!this.publishedValue.filters) {
                setTimeout(function () {
                    this.ready = true;
                    this.fireEvent('ready', this);
                }.bind(this), 3000);
                return;
            }
        }
        else {
            this._updateReleaseValues();
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

    hideHelpButton: function () {
        if (this.filterHelpBtn) {
            this.filterHelpBtn.hide();
        }
    },

    showHelpButton: function () {
        if (this.filterHelpBtn) {
            this.filterHelpBtn.show();
        }
    },

    _getSettingsFields: function (fields) {
        var currentSettings = Rally.getApp().getSettings();
        if (!currentSettings.hasOwnProperty('Utils.AncestorPiAppFilter.projectScope')) {
            currentSettings['Utils.AncestorPiAppFilter.projectScope'] = this.projectScope;
        }
        if (!currentSettings.hasOwnProperty('Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter')) {
            currentSettings['Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter'] = this.displayMultiLevelFilter;
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
            name: 'Utils.AncestorPiAppFilter.projectScope',
            items: [{
                boxLabel: "User's current project(s).",
                name: 'Utils.AncestorPiAppFilter.projectScope',
                inputValue: 'current',
                checked: 'current' === currentSettings['Utils.AncestorPiAppFilter.projectScope'] || this.disableGlobalScope
            }, {
                boxLabel: "All projects in workspace.",
                name: 'Utils.AncestorPiAppFilter.projectScope',
                inputValue: 'workspace',
                checked: 'workspace' === currentSettings['Utils.AncestorPiAppFilter.projectScope'] && !this.disableGlobalScope,
                disabled: this.disableGlobalScope
            }, {
                boxLabel: 'User selectable (either current project(s) or all projects in workspace).',
                name: 'Utils.AncestorPiAppFilter.projectScope',
                inputValue: 'user',
                checked: 'user' === currentSettings['Utils.AncestorPiAppFilter.projectScope'] && !this.disableGlobalScope,
                disabled: this.disableGlobalScope
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
            value: currentSettings['Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter']
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
                    width: this._showIgnoreProjectScopeControl() ? 250 : 0,
                    margin: this._showIgnoreProjectScopeControl() ? '0 10 0 0' : 0,
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
                        labelWidth: this._showIgnoreProjectScopeControl() ? ownerLabelWidth : 0,
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
            this.filterHelpBtn = Ext.widget('rallybutton', {
                itemId: 'filterHelpBtn',
                floating: true,
                shadow: false,
                cls: 'filter-help',
                iconOnly: true,
                iconCls: 'icon-help',
                hidden: this._isSubscriber() || !this._showMultiLevelFilter(),
                handler: (...args) => this.onHelpClicked(...args)
            });
            this.filterHelpBtn.showBy(this.renderArea, 'tr-tr', [-4, 5]);
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
        let enableAncestorFilter = this.cmp.getSetting('Utils.AncestorPiAppFilter.enableAncestorPiFilter2');

        if (enableAncestorFilter === undefined) {
            return false;
        }

        return enableAncestorFilter;
    },

    _showIgnoreProjectScopeControl: function () {
        let showProjectScope = this.cmp.getSetting('Utils.AncestorPiAppFilter.projectScope') === 'user';

        if (showProjectScope === undefined) {
            return this.projectScope;
        }

        return showProjectScope;
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
        else if (this.cmp.getSetting('Utils.AncestorPiAppFilter.projectScope') === undefined) {
            result = this.projectScope === 'workspace';
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
     * Return a list of artifact types AT or below selectedPiTypePath,
     * that are an ancestor of the given modelName, or null if there are no pi type
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
        let showFilters = this.cmp.getSetting('Utils.MultiLevelPiAppFilter.enableMultiLevelPiFilter');

        if (showFilters === undefined) {
            return this.displayMultiLevelFilter;
        }

        return showFilters;
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
                                cls: ` rly-small ${this.filtersHidden ? 'secondary' : 'primary'}`,
                                handler: this._toggleFilters,
                                scope: this,
                                stateId: this.cmp.getContext().getScopedStateId(`multi-filter-toggle-button`),
                                listeners: {
                                    scope: this,
                                    added: function (btn) {
                                        if (this.filtersHidden) {
                                            btn.setFiltersHidden(true);
                                        }

                                        if (btn.filtersHidden) {
                                            btn.setToolTipText('Show Filters');
                                        }
                                        else {
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
                                    itemId: 'multiLevelFilterTabPanel',
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

                                // If a default visible tab is specified, we need to convert an
                                // artifact ordinal to a tab index
                                // Tab indices start at 0 for top-most portfolio item
                                // Artfiact ordinals start at -1 for user stories, 0 for Features, etc...
                                let ordinalLookup = {};
                                let modelLength = Object.keys(models).length;
                                if (this.visibleTab) {
                                    for (let i = 0; i < modelLength; i++) {
                                        ordinalLookup[i] = modelLength - i - 1;
                                    }
                                }

                                _.each(models, function (model, key) {
                                    if (this.visibleTab && this.visibleTab.toLowerCase() === key.toLowerCase()) {
                                        let ord = model.ordinal;
                                        if (typeof ord === 'number') {
                                            let newDefaultTab = ordinalLookup[ord + 1];
                                            if (typeof newDefaultTab === 'number') {
                                                this.defaultTab = newDefaultTab;
                                            }
                                        }
                                    }

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
                                        this.tabPanel.setActiveTab(this.defaultTab);
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

        // The quick filters don't properly clear if the filter isn't displayed
        let activeTab = this.tabPanel.getActiveTab();

        _.each(this.filterControls, function (filterControl) {
            try {
                this.tabPanel.setActiveTab(filterControl.tab);
                filterControl.inlineFilterButton.suspendEvents(false);
                filterControl.inlineFilterButton.clearAllFilters();
                filterControl.inlineFilterButton.saveState();
                filterControl.inlineFilterButton.resumeEvents();
            }
            catch (e) {
                console.log(e);
            }
        }.bind(this));

        this.tabPanel.setActiveTab(activeTab);
        this.resumeEvents();
        this._onFilterChange();
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

    _showError(msg, defaultMessage) {
        Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMessage) });
    },

    parseError(e, defaultMessage) {
        defaultMessage = defaultMessage || 'An unknown error has occurred';

        if (typeof e === 'string' && e.length) {
            return e;
        }
        if (e.message && e.message.length) {
            return e.message;
        }
        if (e.exception && e.error && e.error.errors && e.error.errors.length) {
            if (e.error.errors[0].length) {
                return e.error.errors[0];
            } else {
                if (e.error && e.error.response && e.error.response.status) {
                    return `${defaultMessage} (Status ${e.error.response.status})`;
                }
            }
        }
        if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
            return e.exceptions[0].error.statusText;
        }
        return defaultMessage;
    },

    onHelpClicked() {
        CustomAgile.ui.tutorial.MultiLevelFilterTutorial.showWelcomeDialog(this);
    }
});