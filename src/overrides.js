Ext.override(Rally.ui.inlinefilter.FilterFieldFactory, {
    _getBaseEditorConfig: function (fieldDef, context) {
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

Ext.override(Rally.ui.inlinefilter.InlineFilterPanel, {
    // We don't want chevrons in the tab panel
    _alignChevron: function () {
        if (this.chevron) { this.chevron.hide(); }
    },

    // Don't create the close buttons
    _createCloseButton: function () { }
});

Ext.override(Ext.form.field.ComboBox, {
    select: function (r) {
        if (r && !r.get('ObjectID') && r.get('_uuidRef') === '/allowedattributevalue/') {
            return;
        }
        this.callParent(arguments);
    }
});

Ext.override(Rally.ui.inlinefilter.QuickFilterPanel, {
    getFilters: function () {
        var filters = [];
        _.each(this.fields, function (field, index) {
            if (field.name === 'ModelType') {
                return;
            }

            if (!Ext.isEmpty(field.lastValue) && !field.hasActiveError()) {

                var lastValue = field.lastValue;

                var isRefUri = Rally.util.Ref.isRefUri(lastValue);
                var isRefOid = _.isNumber(Rally.util.Ref.getOidFromRef(lastValue));
                if (isRefUri && isRefOid && field.valueField === '_ref' && field.noEntryValue !== lastValue) {
                    var record = field.getRecord();
                    if (record) {
                        var uuidRef = record.get('_uuidRef');
                        if (uuidRef) {
                            lastValue = uuidRef;
                        }
                    }
                }

                var filter = _.isFunction(field.getFilter) ? field.getFilter() : Rally.data.wsapi.Filter.fromExtFilter({
                    property: field.name,
                    operator: field.operator,
                    value: lastValue
                });

                if (filter && filter.value !== '/allowedattributevalue/') {

                    if (field.allowNoEntry && field.noEntryValue === lastValue) {
                        filter.value = null;
                    }

                    Ext.apply(filter, {
                        name: field.name,
                        rawValue: lastValue,
                        filterIndex: index + 1
                    });

                    filters.push(filter);
                }
            }
        }, this);
        return filters;
    }
});