multiFilterHelpHtml = `
        <h3>This component enables filters to be applied to user stories and all portfolio item levels, regardless of the artifact 
        type(s) displayed in the app.</h3>

        <h3><b>Note:</b> For grid apps that allow expanding individual rows to see child artifacts, these filters are only applied to the top-level artifact type. 
        Child artifacts will not be filtered.</h3>
       
        <div><img src="${multiFilterHelpScreenshot}" alt="Multi-Level Filter Help" style="width:500px;display:block;margin-left:auto;margin-right:auto" /></div>
        
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