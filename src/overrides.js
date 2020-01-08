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