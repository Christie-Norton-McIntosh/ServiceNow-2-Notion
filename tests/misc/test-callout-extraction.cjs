// Paste the actual HTML from your ServiceNow page here
// to test what's happening with the second callout

const axios = require('axios');

const html = `
<div class="zDocsTopicPageBody" data-prismjs-copy="Copy" data-prismjs-copy-error="Text could not be copied. Try using keyboard shortcuts like Ctrl + C to copy instead." data-prismjs-copy-success="Copied!"><div dir="ltr" class="zDocsTopicPageBodyContent"><div><article class="hascomments" data-page="bundle:yokohama-it-service-management/enus/product/enterprise-dev-ops/concept/dev-ops-github-apps-oath-jwt.html" id="bundle:yokohama-it-service-management/enus/product/enterprise-dev-ops/concept/dev-ops-github-apps-oath-jwt.html"><main role="main"><article role="article" class="dita" aria-labelledby="title_dev-ops-github-apps-oath-jwt"><article class="nested0" aria-labelledby="title_dev-ops-github-apps-oath-jwt" id="dev-ops-github-apps-oath-jwt">
   
   
   
   <div class="body conbody"><p class="shortdesc">Perform the following steps to integrate your GitHub Apps using the JWT bearer token.</p>
      <p class="p"><span class="ph uicontrol">Before you begin</span></p>
      <p class="p">Role required:</p>
      <ul class="ul" id="dev-ops-github-apps-oath-jwt__ul_rxd_mpy_jsb">
         <li class="li">oauth_admin in <span class="ph">DevOps Change Velocity</span>.</li>
         <li class="li">Admin account in <span class="ph">GitHub</span>.<div class="note note note_note"><span class="note__title">Note:</span> The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.</div></li>
      </ul>
   </div>
<article class="topic task nested1" aria-labelledby="title_dev-ops-config-github-acct-jwt" id="dev-ops-config-github-acct-jwt">
   <h2 class="title topictitle2" id="title_dev-ops-config-github-acct-jwt">Configure the <span class="ph">GitHub</span> App in your <span class="ph">GitHub</span> account
        (JWT)</h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Create a custom <span class="ph">GitHub</span> App from your <span class="ph">GitHub</span> account to
        enable OAuth 2.0 authentication with your <span class="ph">ServiceNow</span>
        instance.</p>
      <section class="section prereq"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p"><span class="ph">GitHub</span> requirement: <span class="ph">GitHub</span> App configured to integrate with <span class="ph">ServiceNow</span></p>
         <p class="p">Role required: No instance role required</p>
      </section>
      <section class="section context" id="dev-ops-config-github-acct-jwt__context_hbn_kbs_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">About this task</p></div>
         <p class="p">Complete these steps from your <span class="ph">GitHub</span> account. See <a class="xref true-external" href="https://developer.github.com/apps/building-github-apps/" target="_blank">Building <span class="ph">GitHub</span> Apps</a> on the <span class="ph">GitHub</span>
                Developer site for instructions on creating and configuring custom applications.</p>
      </section>
      <section><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps"><li class="li step stepexpand">
            <span class="ph cmd">From your <span class="ph">GitHub</span> account, create your <span class="ph">GitHub</span> App
                    by navigating to <span class="ph menucascade"><span class="ph uicontrol">Developer Settings</span><abbr> &gt; </abbr><span class="ph uicontrol">GitHub Apps</span></span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">Homepage URL</span> field, enter
                        <kbd class="ph userinput">https://&lt;instance-name&gt;.service-now.com</kbd>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">User authorization callback URL</span> field, enter
                        <kbd class="ph userinput">https://&lt;instance-name&gt;.service-now.com/oauth_redirect.do</kbd>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">Identifying and authorizing users</span> section,
                    deselect the <span class="ph uicontrol">Expire user authorization tokens</span>
                    field.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">Webhook</span> section, select the <span class="ph uicontrol">Active</span> field.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">Webhook URL</span> field, enter <kbd class="ph userinput">https://&lt;instance-name&gt;.service-now.com/api/sn_devops/v2/devops/tool/apps?toolId=&lt;Tool ID&gt;</kbd>, where Tool Id is your <span class="ph">GitHub</span> tool id (sys_id) from <span class="ph">DevOps Change Velocity</span>.</span>
            <div class="itemgroup info">
               <div class="note note note_note"><span class="note__title">Note:</span> 
                  <div class="p">If you are newly creating the tool and don't have the Tool ID, you can enter the webhook URL without the Tool ID and configure it later. To configure later:<ol class="ol" type="a" id="dev-ops-config-github-acct-jwt__ol_nmg_pk4_ybc">
                        <li class="li">Navigate to the connected tool's tool record page.</li>
                        <li class="li">Select <span class="ph uicontrol">Configure GitHub App</span>, then select <span class="ph uicontrol">Auto configure with existing token</span>.<p class="p"><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-jwt-config-01.png?_LANG=enus" class="image expandable" id="dev-ops-config-github-acct-jwt__image_omg_pk4_ybc" alt="Auto configure with existing token." data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-jwt-config-01.png?_LANG=enus" data-title="Auto configure with existing token." role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;"></p></li>
                     </ol>This configures the Webhook URL of the GitHub App automatically.</div>
               </div>
               <div class="p">You can get the Tool ID in one of the following ways:<ul class="ul" id="dev-ops-config-github-acct-jwt__ul_qbv_2j4_ybc">
                     <li class="li">While connecting with the tool in <span class="ph">DevOps Change Velocity</span>, the Tool Id is available in the page URL. For example, <code class="ph codeph">https://&lt;instance-name&gt;.service-now.com/.../sn_devops_tool/&lt;Tool ID&gt;/...</code>.</li>
                     <li class="li">You can copy the webhook URL from the <span class="ph">GitHub</span> tool record page in <span class="ph">DevOps Change Velocity</span>, from <span class="ph menucascade"><span class="ph uicontrol">Configure</span><abbr> &gt; </abbr><span class="ph uicontrol">Configure manually</span><abbr> &gt; </abbr><span class="ph uicontrol">Webhook URL</span></span>.</li>
                  </ul></div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Leave the remaining fields empty (default).</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">Repository permissions</span> section, configure the
                    following settings.</span>
            <div class="itemgroup info">
               <div class="table-wrap"><table count-columns="2" class="table frame-all" id="dev-ops-config-github-acct-jwt__table_j5m_wcs_4mb"><caption></caption><colgroup><col style="width:50%"><col style="width:50%"></colgroup><tbody class="tbody">
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Action</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Checks</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Contents</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Deployments</td>
                           <td class="entry colsep-1 rowsep-1">Read and write</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Environments</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Metadata</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Pull requests</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Secrets</td>
                           <td class="entry colsep-1 rowsep-1">Read-only</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1">Webhooks</td>
                           <td class="entry colsep-1 rowsep-1">Read and write<div class="note note note_note"><span class="note__title">Note:</span> Read and write permissions are
                                            required to configure webhooks from <span class="ph">ServiceNow</span>.</div></td>
                        </tr>
                     </tbody></table></div>
               <div class="note note note_note"><span class="note__title">Note:</span> If you are already using a GitHub App and you update any of the permissions, you must review and accept those permissions for your GitHub App. You can navigate to your app, and select <span class="ph uicontrol">Configure &gt; Review
                     request &gt; Accept new permissions</span>.</div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Leave the remaining permissions as <kbd class="ph userinput">No access</kbd>
                    (default).</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">In the <span class="ph uicontrol">Subscribe to events</span> section, select the <span class="ph uicontrol">Deployment protection rule</span> option.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Save the changes.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">After creating the <span class="ph">GitHub</span> App, generate a new private key and
                    save it to your machine.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Install the newly created <span class="ph">GitHub</span> App on the accounts of your
                    choice.</span>
            <ol type="a" class="ol substeps" id="dev-ops-config-github-acct-jwt__substeps_v31_znx_qvb">
               <li class="li substep substepexpand">
                  <span class="ph cmd">From the GitHub Apps settings page, select your app.</span>
               </li>
               <li class="li substep substepexpand">
                  <span class="ph cmd">In the left sidebar, select <span class="ph uicontrol">Install App</span>.</span>
               </li>
               <li class="li substep substepexpand">
                  <span class="ph cmd">Select <span class="ph uicontrol">Install</span> next to the organization or
                            personal account containing the correct repository.</span>
               </li>
               <li class="li substep substepexpand">
                  <span class="ph cmd">Install the app on all repositories or select repositories.</span>
                  <div class="itemgroup info">For more information, see <a class="xref true-external" href="https://docs.github.com/en/developers/apps/managing-github-apps/installing-github-apps" target="_blank">Installing GitHub Apps</a>.</div>
               </li>
            </ol>
         </li></ol></section>
   </div>
</article><article class="topic task nested1" aria-labelledby="title_dev-ops-generate-jks-cert-github" id="dev-ops-generate-jks-cert-github">
   <h2 class="title topictitle2" id="title_dev-ops-generate-jks-cert-github">Generate the Java KeyStore certificate for <span class="ph">GitHub</span></h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Generate a Java KeyStore (JKS) certificate for the JWT authentication.</p>
      <section class="section prereq" id="dev-ops-generate-jks-cert-github__prereq_ihr_rpr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p">Role required: admin</p>
      </section>
      <section id="dev-ops-generate-jks-cert-github__steps_jhr_rpr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps" id="dev-ops-generate-jks-cert-github__steps_jhr_rpr_4mb"><li class="li step stepexpand">
            <span class="ph cmd">Create a CA signed certificate using the <span class="ph">GitHub</span> App private
                    key:</span>
            <div class="itemgroup info">
               
            </div><pre class="language-plaintext" data-language="plaintext">openssl req -new -x509 -key &lt;file-name&gt;.pem -out &lt;certificate-name&gt;.pem -days 1095</pre>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Enter the required details.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Create the PKCS 12 file using the <span class="ph">GitHub</span> App private key and CA
                    signed certificate:</span>
            <div class="itemgroup info">
               
            </div><pre class="language-plaintext" data-language="plaintext">openssl pkcs12 -export -in &lt;certificate-name&gt;.pem -inkey &lt;file-name&gt;.pem -certfile &lt;certificate-name&gt;.pem -out &lt;PKCS-12-file-name&gt;.p12 </pre>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Provide the export password.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Create the JKS file:</span>
            <div class="itemgroup info">
               
            </div><pre class="language-plaintext" data-language="plaintext">keytool -importkeystore -srckeystore &lt;PKCS-12-file-name&gt;.p12 -srcstoretype pkcs12 -destkeystore &lt;JKS-certificate-filename&gt;.jks -deststoretype JKS</pre>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Provide the destination and source keystore passwords.</span>
         </li></ol></section>
   </div>
</article><article class="topic task nested1" aria-labelledby="title_dev-ops-attach-jks-cert-github" id="dev-ops-attach-jks-cert-github">
   <h2 class="title topictitle2" id="title_dev-ops-attach-jks-cert-github">Attach the <span class="ph">GitHub</span> Java KeyStore certificate to your instance</h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Enable the JWT Bearer Grant token authentication by attaching the valid GitHub Java KeyStore (JKS) certificate to your ServiceNow instance.</p>
      <section class="section prereq"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p">Ensure the availability of a valid Java KeyStore certificate.</p>
         <p class="p">Role required: admin</p>
      </section>
      <section id="dev-ops-attach-jks-cert-github__steps_ifm_5dw_bhb"><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps" id="dev-ops-attach-jks-cert-github__steps_ifm_5dw_bhb"><li class="li step stepexpand">
            <span class="ph cmd">Navigate to <span class="ph menucascade"><span class="ph uicontrol">All</span><abbr> &gt; </abbr><span class="ph uicontrol">System Definition</span><abbr> &gt; </abbr><span class="ph uicontrol">Certificates</span></span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">New</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">On the form, fill in the fields.</span>
            <div class="itemgroup info">
               <div class="table-wrap"><div id="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb_wrapper" class="dataTables_wrapper no-footer"><div id="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb_filter" class="dataTables_filter"></div><div class="zDocsFilterTableDiv zDocsFilterColumnsTableDiv"></div><table count-columns="2" class="table frame-all dataTable no-footer" id="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb"><caption><span class="table--title-label">Table 1. </span><span class="title">X.509 Certificate form fields</span></caption><colgroup><col><col></colgroup><thead class="thead">
                        <tr class="row"><th class="entry colsep-1 rowsep-1 sorting" id="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1" tabindex="0" aria-controls="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb" rowspan="1" colspan="1" aria-label="Field: activate to sort column ascending">Field</th><th class="entry colsep-1 rowsep-1 sorting" id="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2" tabindex="0" aria-controls="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb" rowspan="1" colspan="1" aria-label="Description: activate to sort column ascending">Description</th></tr>
                     </thead><tbody class="tbody">
                        
                        
                        
                        
                        
                        
                        
                        
                     <tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Name</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Name to uniquely identify the record. For example,
                                            <kbd class="ph userinput">My GitHub App
                                        Certificate</kbd>.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Notify on expiration</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Option to specify the users to be notified when the
                                        certificate expires.</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Warn in days to expire</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Number of days to send a notification before the
                                        certificate expires.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Active</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Option to enable the certificate.</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Type</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Option to select the type of the certificate. Select
                                            <span class="ph uicontrol">Java Key Store</span>.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Expires in days</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Number of days until the certificate expires.</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Key store password</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Password associated with the certificate (hint: the
                                        destination KeyStore password previously created).</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__1">Short description</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-attach-jks-cert-github__table_hvh_4tt_xgb__entry__2">Summary about the certificate.</td>
                        </tr></tbody></table></div></div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select the attachments icon (<img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/dev-ops-attachments-icon.png?_LANG=enus" class="image icon" id="dev-ops-attach-jks-cert-github__image_r3j_22n_xgb" alt="Attachments icon">) and attach a JKS certificate.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">Validate Stores/Certificates</span>.</span>
         </li></ol></section>
   </div>
</article><article class="topic task nested1" aria-labelledby="title_dev-ops-create-jwt-key-github" id="dev-ops-create-jwt-key-github">
   <h2 class="title topictitle2" id="title_dev-ops-create-jwt-key-github">Create a JWT signing key for the <span class="ph">GitHub</span> JKS certificate</h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Create a JSON Web Token (JWT) signing key to assign to your <span class="ph">GitHub</span>
        Java KeyStore certificate.</p>
      <section class="section prereq" id="dev-ops-create-jwt-key-github__prereq_ihr_rpr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p">Role required: admin, sn_devops.admin</p>
      </section>
      <section id="dev-ops-create-jwt-key-github__steps_zjg_4tr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps" id="dev-ops-create-jwt-key-github__steps_zjg_4tr_4mb"><li class="li step stepexpand">
            <span class="ph cmd">Navigate to <span class="ph menucascade"><span class="ph uicontrol">All</span><abbr> &gt; </abbr><span class="ph uicontrol">System OAuth</span><abbr> &gt; </abbr><span class="ph uicontrol">JWT Keys</span></span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">New</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">On the form, fill in the fields.</span>
            <div class="itemgroup info">
               <div class="table-wrap"><div id="dev-ops-create-jwt-key-github__table_jky_dk5_xgb_wrapper" class="dataTables_wrapper no-footer"><div id="dev-ops-create-jwt-key-github__table_jky_dk5_xgb_filter" class="dataTables_filter"></div><div class="zDocsFilterTableDiv zDocsFilterColumnsTableDiv"></div><table count-columns="2" class="table frame-all dataTable no-footer" id="dev-ops-create-jwt-key-github__table_jky_dk5_xgb"><caption><span class="table--title-label">Table 2. </span><span class="title">JWT Keys form fields</span></caption><colgroup><col><col></colgroup><thead class="thead">
                        <tr class="row"><th class="entry colsep-1 rowsep-1 sorting" id="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1" tabindex="0" aria-controls="dev-ops-create-jwt-key-github__table_jky_dk5_xgb" rowspan="1" colspan="1" aria-label="Field: activate to sort column ascending">Field</th><th class="entry colsep-1 rowsep-1 sorting" id="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2" tabindex="0" aria-controls="dev-ops-create-jwt-key-github__table_jky_dk5_xgb" rowspan="1" colspan="1" aria-label="Description: activate to sort column ascending">Description</th></tr>
                     </thead><tbody class="tbody">
                        
                        
                        
                        
                        
                        
                     <tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1">Name</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2">Name to uniquely identify the JWT signing key. For
                                        example, <kbd class="ph userinput">My GitHub App JWT
                                        Key</kbd>.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1">Signing Keystore</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2">Valid JKS certificate attached in the previous task. For
                                        example, <kbd class="ph userinput">My GitHub App
                                        Certificate</kbd>.</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1">Key Id</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2">Unique Id to identify which key is used when multiple
                                        keys are used to sign tokens.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1">Signing Algorithm</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2">Algorithm to sign with the JWT key (hint: RSA
                                        256).</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1">Signing Key Password</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2">Password associated with the signing key (hint: the
                                        source keystore password previously created).</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__1">Active</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-key-github__table_jky_dk5_xgb__entry__2">Option to enable the key.</td>
                        </tr></tbody></table></div></div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">Submit</span>.</span>
         </li></ol></section>
   </div>
</article><article class="topic task nested1" aria-labelledby="title_dev-ops-create-jwt-prov-github" id="dev-ops-create-jwt-prov-github">
   <h2 class="title topictitle2" id="title_dev-ops-create-jwt-prov-github">Create a JWT provider for your <span class="ph">GitHub</span> signing key</h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Add a JSON Web Token (JWT) provider to your <span class="ph">ServiceNow</span> instance for <span class="ph">GitHub</span>.</p>
      <section class="section prereq" id="dev-ops-create-jwt-prov-github__prereq_ihr_rpr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p">Role required: admin, sn_devops.admin</p>
      </section>
      <section id="dev-ops-create-jwt-prov-github__steps_ung_p5r_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps" id="dev-ops-create-jwt-prov-github__steps_ung_p5r_4mb"><li class="li step stepexpand">
            <span class="ph cmd">Navigate to <span class="ph menucascade"><span class="ph uicontrol">All</span><abbr> &gt; </abbr><span class="ph uicontrol">System OAuth</span><abbr> &gt; </abbr><span class="ph uicontrol">JWT Providers</span></span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">New</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">On the form, fill in the fields.</span>
            <div class="itemgroup info">
               <div class="table-wrap"><table count-columns="2" class="table frame-all" id="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb"><caption><span class="table--title-label">Table 3. </span><span class="title">JWT Provider form fields</span></caption><colgroup><col><col></colgroup><thead class="thead">
                        <tr class="row">
                           <th class="entry colsep-1 rowsep-1" id="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__1">Field</th>
                           <th class="entry colsep-1 rowsep-1" id="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__2">Description</th>
                        </tr>
                     </thead><tbody class="tbody">
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__1">Name</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__2">Name to uniquely identify the JWT provider. For example,
                                            <kbd class="ph userinput">My GitHub App JWT
                                        Provider</kbd>.</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__1">Expiry Interval (sec)</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__2">Number in seconds to set the lifespan of JWT provider
                                        tokens (Hint: You can leave it as default).</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__1">Signing Configuration</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-jwt-prov-github__table_l5g_3m5_xgb__entry__2">Valid JWT signing key previously created. For example,
                                            <kbd class="ph userinput">My GitHub App JWT Key</kbd>.</td>
                        </tr>
                     </tbody></table></div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Right-click the form header, and select <span class="ph uicontrol">Save</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Enter your <span class="ph">GitHub</span> App <span class="ph uicontrol">App ID</span> (available
                    in the <span class="ph uicontrol">About</span> section of your <span class="ph">GitHub</span> App
                    configuration in <span class="ph">GitHub</span> ) as the value of the
                        <span class="ph uicontrol">iss</span> claim, in the Standard Claims related list.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Leave <span class="ph uicontrol">aud</span> and <span class="ph uicontrol">sub</span> values blank
                    (default).</span>
         </li></ol></section>
   </div>
</article><article class="topic task nested1" aria-labelledby="title_dev-ops-reg-github-oauth-prov-jwt" id="dev-ops-reg-github-oauth-prov-jwt">
   <h2 class="title topictitle2" id="title_dev-ops-reg-github-oauth-prov-jwt">Register <span class="ph">GitHub</span> as an OAuth Provider (JWT)</h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Use the information generated during <span class="ph">GitHub</span> App account configuration
        to register <span class="ph">GitHub</span> as an OAuth provider and allow the instance to request
        OAuth 2.0 tokens.</p>
      <section class="section prereq" id="dev-ops-reg-github-oauth-prov-jwt__prereq_ihr_rpr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p">Role required: admin, sn_devops.admin</p>
      </section>
      <section id="dev-ops-reg-github-oauth-prov-jwt__steps_ed2_2xr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps" id="dev-ops-reg-github-oauth-prov-jwt__steps_ed2_2xr_4mb"><li class="li step stepexpand">
            <span class="ph cmd">Navigate to <span class="ph menucascade"><span class="ph uicontrol">All</span><abbr> &gt; </abbr><span class="ph uicontrol">System OAuth</span><abbr> &gt; </abbr><span class="ph uicontrol">Application Registry</span></span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">New</span>.</span>
            <div class="itemgroup stepresult">The <span class="ph uicontrol">What kind of OAuth application?</span> message is
                    displayed.</div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">Connect to a third party OAuth Provider</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">On the form, fill in the fields.</span>
            <div class="itemgroup info">
               <div class="table-wrap"><div id="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb_wrapper" class="dataTables_wrapper no-footer"><div id="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb_filter" class="dataTables_filter"></div><div class="zDocsFilterTableDiv zDocsFilterColumnsTableDiv"></div><table count-columns="2" class="table frame-all dataTable no-footer" id="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb"><caption><span class="table--title-label">Table 4. </span><span class="title">Application Registry form fields</span></caption><colgroup><col><col></colgroup><thead class="thead">
                        <tr class="row"><th class="entry colsep-1 rowsep-1 sorting" id="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1" tabindex="0" aria-controls="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb" rowspan="1" colspan="1" aria-label="Field: activate to sort column ascending">Field</th><th class="entry colsep-1 rowsep-1 sorting" id="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2" tabindex="0" aria-controls="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb" rowspan="1" colspan="1" aria-label="Description: activate to sort column ascending">Description</th></tr>
                     </thead><tbody class="tbody">
                        
                        
                        
                        
                        
                        
                     <tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1">Name</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2">Name to uniquely identify the record. For example, enter
                                            <kbd class="ph userinput">My GitHub App Provider</kbd>.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1">Client ID</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2">Client ID of your <span class="ph">GitHub</span> App (hint:
                                        available in the <span class="ph uicontrol">About</span> section of
                                        your <span class="ph">GitHub</span> App configuration in <span class="ph">GitHub</span> ).</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1">Client Secret</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2">Client secret of your <span class="ph">GitHub</span> App (hint:
                                        available in the <span class="ph uicontrol">About</span> section of
                                        your <span class="ph">GitHub</span> App configuration in <span class="ph">GitHub</span> ).</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1">OAuth API script</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2">Option that enables you to reference an amended OAuthUtil
                                        script include. Select
                                            <span class="ph uicontrol">OAuthDevOpsGitHubJWTHandler</span>.</td>
                        </tr><tr class="row odd">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1">Default Grant type</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2">Type of grant associated with application registry.
                                        Select <span class="ph uicontrol">JWT Bearer</span>.</td>
                        </tr><tr class="row even">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__1">Token URL</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-reg-github-oauth-prov-jwt__table_fd2_2xr_4mb__entry__2">The location of the token endpoint that the instance uses to retrieve and refresh tokens. <p class="p">For cloud version, enter:
                                    <kbd class="ph userinput">https://api.github.com/app/installations/&lt;installation_id&gt;/access_tokens</kbd>.</p><p class="p">For enterprise version, enter:
                                    <kbd class="ph userinput">https://&lt;HOST_URL&gt;/api/v3/app/installations/&lt;installation_id&gt;/access_tokens</kbd>.</p><p class="p">For the installation id, go to Install App section in your GitHub App configuration in
                                 GitHub and select the gear icon to configure your app. The installation id will be in the webpage URL. For example, https://github.com/settings/installations/&lt;installation_id&gt;.</p></td>
                        </tr></tbody></table></div></div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Leave the rest of the form fields as default.</span>
            <div class="itemgroup info"><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-oauth-jwt-app-registries.png?_LANG=enus" class="image expandable" id="dev-ops-reg-github-oauth-prov-jwt__image_b5x_jgp_31c" alt="Application Registry form" data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-oauth-jwt-app-registries.png?_LANG=enus" data-title="Application Registry form" role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;"></div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Right-click the form header, and select <span class="ph uicontrol">Save</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Open the default profile created in the <span class="ph uicontrol">OAuth Entity
                        Profiles</span> related list.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Populate the <span class="ph uicontrol">JWT Provider</span> field with the JWT provider
                    previously created and save the form.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Navigate to <span class="ph uicontrol">Key Management &gt; Module Access Policies &gt;
               All</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select the policy that has <span class="ph uicontrol">com_snc_platform_security_oauth_glideencrypter</span> as the <span class="ph uicontrol">Crypto module</span> field value and <span class="ph uicontrol">Script Include: OAuthDevOpsGitHubJWTHandler</span>
               as the <span class="ph uicontrol">Target script</span> field value.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Ensure the <span class="ph uicontrol">Result</span> field is set to <span class="ph uicontrol">Track</span>
               and save the changes.</span>      
            <div class="itemgroup info"><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-oauth-provider.png?_LANG=enus" class="image expandable" alt="Form that shows the result field is set to track." data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-oauth-provider.png?_LANG=enus" data-title="Form that shows the result field is set to track." role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;"></div>
         </li></ol></section>
   </div>
</article><article class="topic task nested1" aria-labelledby="title_dev-ops-create-cred-github-jwt" id="dev-ops-create-cred-github-jwt">
   <h2 class="title topictitle2" id="title_dev-ops-create-cred-github-jwt">Create a credential record for <span class="ph">GitHub</span> App provider (JWT)</h2>
   
   
   <div class="body taskbody"><p class="shortdesc">Create a credential record to the <span class="ph">GitHub</span> App provider previously
        created to authorize actions.</p>
      <section class="section prereq" id="dev-ops-create-cred-github-jwt__prereq_ihr_rpr_4mb"><div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
         <p class="p">Role required: admin, sn_devops.admin</p>
      </section>
      <section id="dev-ops-create-cred-github-jwt__steps_o5h_52j_qfb"><div class="tasklabel"><p class="sectiontitle tasklabel">Procedure</p></div><ol class="ol steps" id="dev-ops-create-cred-github-jwt__steps_o5h_52j_qfb"><li class="li step stepexpand">
            <span class="ph cmd">Navigate to <span class="ph menucascade"><span class="ph uicontrol">All</span><abbr> &gt; </abbr><span class="ph uicontrol">Connections &amp; Credentials</span><abbr> &gt; </abbr><span class="ph uicontrol">Credentials</span></span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">New</span>.</span>
            <div class="itemgroup stepresult">The <span class="ph uicontrol">What type of Credentials would you like to
                        create?</span> message is displayed.</div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select <span class="ph uicontrol">OAuth 2.0 Credentials</span>.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">On the form, fill in the fields.</span>
            <div class="itemgroup info">
               <div class="table-wrap"><table count-columns="2" class="table frame-all" id="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb"><caption><span class="table--title-label">Table 5. </span><span class="title">OAuth 2.0 Credentials form fields</span></caption><colgroup><col><col></colgroup><thead class="thead">
                        <tr class="row">
                           <th class="entry colsep-1 rowsep-1" id="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__1">Field</th>
                           <th class="entry colsep-1 rowsep-1" id="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__2">Value required</th>
                        </tr>
                     </thead><tbody class="tbody">
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__1">Name</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__2">Name to uniquely identify the record. For example, enter
                                            <kbd class="ph userinput">My GitHub App Credential</kbd>.</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__1">Active</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__2">Option to enable the record.</td>
                        </tr>
                        <tr class="row">
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__1">OAuth Entity Profile</td>
                           <td class="entry colsep-1 rowsep-1" headers="dev-ops-create-cred-github-jwt__table_sxv_zgp_gfb__entry__2">Default OAuth Entity profile created in the Application
                                        Registry.</td>
                        </tr>
                     </tbody></table></div>
            </div>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Save the record.</span>
         </li><li class="li step stepexpand">
            <span class="ph cmd">Select the <span class="ph uicontrol">Get OAuth Token</span> related link to generate the
                    OAuth token.</span>
         </li></ol></section>
   </div>
   <nav role="navigation"></nav><nav role="navigation" class="tasksNavigation"></nav>
</article></article></article></main></article></div></div><div class="contentPlaceholder" style="height: 706.5px;"><div class="contentContainer zDocsSideBoxes withExpandCollapse zDocsSideBoxesFloating
        withStickyTitle floating undefined" style="top: 30px;"><div class="contentWrapper" style="height: 706.5px;"><div class="miniTOC d-none d-md-block"><div class="miniTOCHeader"><h5 class="miniTOCTitle css-g931ng">On this page</h5></div><ul class="linkList"><li class="linkItem"><a class="link  css-ettsdk" href="#title_dev-ops-config-github-acct-jwt" id="miniTOC-title_dev-ops-config-github-acct-jwt">Configure the GitHub App in your GitHub account
        (JWT)</a><ul id="miniTOC-collapse-title_dev-ops-config-github-acct-jwt" class="level-2 linkList"></ul></li><li class="linkItem"><a class="link active css-ettsdk" href="#title_dev-ops-generate-jks-cert-github" id="miniTOC-title_dev-ops-generate-jks-cert-github">Generate the Java KeyStore certificate for GitHub</a><ul id="miniTOC-collapse-title_dev-ops-generate-jks-cert-github" class="level-2 linkList"></ul></li><li class="linkItem"><a class="link  css-ettsdk" href="#title_dev-ops-attach-jks-cert-github" id="miniTOC-title_dev-ops-attach-jks-cert-github">Attach the GitHub Java KeyStore certificate to your instance</a><ul id="miniTOC-collapse-title_dev-ops-attach-jks-cert-github" class="level-2 linkList"></ul></li><li class="linkItem"><a class="link  css-ettsdk" href="#title_dev-ops-create-jwt-key-github" id="miniTOC-title_dev-ops-create-jwt-key-github">Create a JWT signing key for the GitHub JKS certificate</a><ul id="miniTOC-collapse-title_dev-ops-create-jwt-key-github" class="level-2 linkList"></ul></li><li class="linkItem"><a class="link  css-ettsdk" href="#title_dev-ops-create-jwt-prov-github" id="miniTOC-title_dev-ops-create-jwt-prov-github">Create a JWT provider for your GitHub signing key</a><ul id="miniTOC-collapse-title_dev-ops-create-jwt-prov-github" class="level-2 linkList"></ul></li><li class="linkItem"><a class="link  css-ettsdk" href="#title_dev-ops-reg-github-oauth-prov-jwt" id="miniTOC-title_dev-ops-reg-github-oauth-prov-jwt">Register GitHub as an OAuth Provider (JWT)</a><ul id="miniTOC-collapse-title_dev-ops-reg-github-oauth-prov-jwt" class="level-2 linkList"></ul></li><li class="linkItem"><a class="link  css-ettsdk" href="#title_dev-ops-create-cred-github-jwt" id="miniTOC-title_dev-ops-create-cred-github-jwt">Create a credential record for GitHub App provider (JWT)</a><ul id="miniTOC-collapse-title_dev-ops-create-cred-github-jwt" class="level-2 linkList"></ul></li></ul></div><div><h5 class=" css-g931ng" aria-level="5">Related Content</h5><ul><li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/github-actions-integration-with-devops.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>GitHub Actions configurations</a><p>Configuration information on GitHub Actions, such as, secrets, workflows, and limitations.</p></li><li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/servicenow-devops-custom-actions-from-github-marketplace.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>ServiceNow DevOps custom actions from GitHub marketplace</a><p>Use the custom actions from the GitHub marketplace to collect SonarQube scan data, security data, pause or resume workflow, or resume workflow until a change request is approved or rejected in your instance, or get and update change request details and so on.</p></li><li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/github-deployment-gate-for-servicenow-devops-change.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>GitHub Deployment Gates for ServiceNow DevOps Change</a><p>Use the GitHub Deployment Gate capability to decide on whether a new deployment should proceed or halt.</p></li></ul></div></div></div></div></div>
`;

console.log('Testing ServiceNow HTML extraction...\n');
console.log('HTML length:', html.length);
console.log('\nSending to proxy with SN2N_EXTRA_DEBUG enabled...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Callout Extraction Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`\n✅ Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    
    if (block.type === 'callout') {
      const content = block.callout.rich_text.map(rt => rt.text.content).join('');
      console.log(`  Full content: "${content}"`);
      console.log(`  Rich text elements: ${block.callout.rich_text.length}`);
      console.log(`  Color: ${block.callout.color}`);
      console.log(`  Icon: ${block.callout.icon.emoji}`);
      
      // Check for markers
      if (content.includes('sn2n:')) {
        console.log(`  ⚠️  Contains marker!`);
      }
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
  if (error.response?.data?.details) {
    console.error('Details:', JSON.stringify(error.response.data.details, null, 2));
  }
});
