Ext.define('CustomAgile.ui.tutorial.MultiLevelFilterTutorial', {
    singleton: true,

    welcomeHtml: `
        <h3>This component enables filters to be applied to user stories and all levels within the portfolio item hierarchy, regardless of the artifact 
        type displayed in the app.</h3>

        <h3><b>Note:</b> For grid apps that allow expanding individual rows to see child artifacts, these filters are only applied to the top-level artifact type. 
        Child artifacts will not be filtered.</h3>
    `,

    defaultOffset: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 }
    ],

    defaultChevronOffset: [
        { x: 0, y: -14 },
        { x: 14, y: 0 },
        { x: 0, y: 14 },
        { x: -8, y: 0 }
    ],

    showWelcomeDialog: function (app) {
        this.app = app;
        this.steps = this.getSteps();

        if (this.app.showFiltersBtn && this.app.showFiltersBtn.filtersHidden) {
            this.app._toggleFilters(this.app.showFiltersBtn);
        }

        let appHeight = Rally.getApp().getHeight() - 25;

        this.welcomeDialog = Ext.create('Rally.ui.dialog.Dialog', {
            autoShow: true,
            layout: 'fit',
            componentCls: 'rly-popover dark-container',
            width: 500,
            height: appHeight < 300 ? appHeight : 300,
            closable: true,
            autoDestroy: true,
            buttonAlign: 'center',
            autoScroll: true,
            title: 'Using the Multi-Level Filter',
            items: {
                xtype: 'component',
                html: this.welcomeHtml,
                padding: 10,
                style: 'font-size:12px;'
            },
            buttons: [
                {
                    xtype: "rallybutton",
                    text: 'Close',
                    cls: 'secondary rly-small',
                    listeners: {
                        click: () => {
                            this.welcomeDialog.close();
                        },
                        scope: this
                    }
                }, {
                    xtype: "rallybutton",
                    text: 'Next',
                    cls: 'primary rly-small',
                    listeners: {
                        click: function () {
                            this.showNextStep(0);
                            this.welcomeDialog.close();
                        },
                        scope: this
                    }
                }
            ]
        });
    },

    showNextStep: function (stepIndex) {
        if (this.popover) {
            Ext.destroy(this.popover);
        }

        if (stepIndex >= this.steps.length) {
            return;
        }

        if (stepIndex === -1) {
            this.showWelcomeDialog(this.app);
            return;
        }

        let currentStep = this.steps[stepIndex];

        if (currentStep.handler) {
            currentStep.handler();
        }

        let buttons = [{
            xtype: "rallybutton",
            text: 'Close',
            cls: 'secondary rly-small',
            listeners: {
                click: () => {
                    this.popover.close();
                },
                scope: this
            }
        }];

        buttons.push({
            xtype: "rallybutton",
            text: 'Previous',
            cls: 'primary rly-small',
            listeners: {
                click: function () {
                    this.showNextStep(stepIndex - 1);
                },
                scope: this
            }
        });

        if (stepIndex < this.steps.length - 1) {
            buttons.push({
                xtype: "rallybutton",
                text: 'Next',
                cls: 'primary rly-small',
                listeners: {
                    click: function () {
                        this.showNextStep(stepIndex + 1);
                    },
                    scope: this
                }
            });
        }

        let appHeight = Rally.getApp().getHeight() - 25;

        this.popover = Ext.create('Rally.ui.popover.Popover', {
            target: Rally.getApp().down(currentStep.target).getEl(),
            placement: currentStep.placement || ['bottom', 'left', 'top', 'right'],
            chevronOffset: currentStep.chevronOffset || this.defaultChevronOffset,
            offsetFromTarget: currentStep.offset || this.defaultOffset,
            overflowY: 'auto',
            maxWidth: 550,
            maxHeight: appHeight < 700 ? appHeight : 700,
            toFront: Ext.emptyFn,
            buttonAlign: 'center',
            title: currentStep.title,
            listeners: {
                destroy: function () {
                    this.popover = null;
                },
                scope: this
            },
            html: `<div class="tutorial-popover-body">${currentStep.html}</div>`,
            buttons
        });
    },

    getSteps: function () {
        let steps = [];

        if (this.app.publisher) {
            steps.push({
                target: '#pubSubIndicatorArea',
                placement: 'right',
                title: 'Broadcaster Indicator',
                offset: [
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                    { x: 14, y: 0 },
                    { x: 0, y: 0 }
                ],
                chevronOffset: [
                    { x: 0, y: -14 },
                    { x: 14, y: -40 },
                    { x: 0, y: 14 },
                    { x: -8, y: 0 }
                ],
                html: `
           <p><span class="icon-bullhorn icon-large"></span> This bullhorn icon indicates that the app is broadcasting the selected filters to any apps on the page
         that are listening for filter changes.</p>
            `
            });
        }

        if (this.app._showAncestorFilter()) {
            steps.push({
                target: '#ancestorFilterArea',
                placement: 'bottom',
                title: 'Ancestor Filter',
                html: `
         <p>The ancestor filter allows you to filter the data to show only artifacts that are descendants of the selected artifact. 
         Use the PI Type dropdown to choose which type of Portfolio Item you want the ancestor artifact to be.</p> 
            `
            });
        }

        if (this.app._showIgnoreProjectScopeControl()) {
            let scopeOffsetX = this.app._showAncestorFilter() ? 0 : -250;
            steps.push({
                target: '#ignoreScopeControl',
                placement: 'bottom',
                title: 'Scope Control',
                offset: [
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                    { x: 0, y: 15 },
                    { x: 0, y: 0 }
                ],
                chevronOffset: [
                    { x: 0, y: -14 },
                    { x: 14, y: 0 },
                    { x: scopeOffsetX, y: 14 },
                    { x: -8, y: 0 }
                ],
                html: `
           <p>This dropdown controls whether the filters and resulting data will be scoped to the current project (Obeying the user's 
        Project Scope Down and Project Scope Up settings) or scoped across all projects within the workspace.</p>
        <p>Depending upon the app and the filters, scoping across all projects may result in performance issues or timeout errors from the server. To ensure 
        timely performance, use filters that will return a manageable number of results.</p>
            `
            });
        }

        let buttonOffsetX = !this.app._showAncestorFilter() && !this.app._showIgnoreProjectScopeControl() ? -225 : 0;

        steps.push({
            target: 'multifiltertogglebtn',
            placement: 'bottom',
            title: 'Hide/Clear/Apply Filter Buttons',
            offset: [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
                { x: 0, y: 14 },
                { x: 0, y: 0 }
            ],
            chevronOffset: [
                { x: 0, y: -14 },
                { x: 14, y: 0 },
                { x: buttonOffsetX, y: 14 },
                { x: -8, y: 0 }
            ],
            html: `
           <ul class="filter-help-list">
        <li><b>Show/Hide Filters: </b>Used to toggle the visibility of the filter controls. Use this to hide the filters if they're 
        not needed or more space is needed within the app</li>
        
        <li><b>Clear Filters: </b>Once at least 1 filter is applied, this button will appear. This button will clear all of the quick filters and advanced filters across all artifact types. 
        Upon clearing the filters, the app will refresh its data.</li>
        
        <li><b>Apply Filters: </b>If present, this button becomes active after a single change is made to one of the filters. This button 
        allows the user to make multiple changes without the app refreshing after each change. Once the user has modified all of 
        the necessary filters, clicking this button will apply it to the app and refresh the data. If this button is not present, 
        the app will refresh after each change made to the filters.</li>
        </ul>
            `
        },
            {
                target: '#multiLevelFilterTabPanel tabbar tab',
                placement: 'bottom',
                title: 'Artifact Type Tabs',
                offset: [
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                    { x: 0, y: 14 },
                    { x: 0, y: 0 }
                ],
                chevronOffset: [
                    { x: 0, y: -14 },
                    { x: 14, y: 0 },
                    { x: -25, y: 14 },
                    { x: -8, y: 0 }
                ],
                html: `
           <p>Each tab contains a unique filter that will apply filters at the level of the specified artifact type. 
        If the tab title ends with a number in parenthesis, this indicates the current number of filters applied at that level.</p>
            `
            },
            {
                target: '#' + this.app.btnRenderAreaId,
                placement: 'bottom',
                title: 'Errors',
                chevronOffset: [
                    { x: 0, y: -14 },
                    { x: 14, y: 0 },
                    { x: 0, y: 28 },
                    { x: -8, y: 0 }
                ],
                html: `
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
        stories across the workspace. The results would be over ten thousand records, which would take very long to load, or would fail 
        to load due to timeout errors. This is an example of when we would see this error. Using more specific filters, or scoping to a specific 
        project hierarchy would solve this issue.
        </li>
        </ul>
            `
            });

        return steps;
    }
});