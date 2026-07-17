import{t as e}from"./main-BTZd_Myc.js";var t=class{constructor(e){this.msp=e,this.isMonitoring=!1,this.metrics={totalRequests:0,completedRequests:0,failedRequests:0,timeouts:0,duplicates:0,avgResponseTime:0,maxResponseTime:0,queuePeakSize:0,requestsByCode:new Map,responseTimes:[],errorsByType:new Map},this.alerts={queueFull:!1,highTimeout:!1,slowResponses:!1,memoryLeak:!1},this.thresholds={maxQueueSize:Math.floor((this.msp.MAX_QUEUE_SIZE||100)*.8),maxAvgResponseTime:2e3,maxTimeoutRate:.1,memoryLeakThreshold:100},this.monitoringInterval=null,this.listeners=[],this._hookMSPMethods()}_hookMSPMethods(){if(this.msp._mspQueueMonitorInstrumented){console.warn(`MSP instance is already instrumented by MSPQueueMonitor`);return}this.originalSendMessage=this.msp.send_message.bind(this.msp),this.originalDispatchMessage=this.msp._dispatch_message.bind(this.msp),this.msp.send_message=(...e)=>(this._trackRequestStart(e[0],e[1]),this.originalSendMessage(...e)),this.msp._dispatch_message=(...e)=>{let t=null;if(Array.isArray(this.msp.callbacks)){let e=this.msp.code,n=this.msp.message_buffer;if(e!==void 0&&n)if(typeof this.msp._getRequestKey==`function`){let r=this.msp._getRequestKey(e,n);t=this.msp.callbacks.find(e=>e.requestKey===r)}else t=this.msp.callbacks.find(t=>t.code===e)}return t&&this._trackRequestCompletion(t),this._trackResponse(),this.originalDispatchMessage(...e)},this.msp._mspQueueMonitorInstrumented=!0}_trackRequestStart(e,t){this.metrics.totalRequests++;let n=this.metrics.requestsByCode.get(e)||0;this.metrics.requestsByCode.set(e,n+1);try{(this.msp.callbacks||[]).some(n=>{if(n.code!==e)return!1;let r=t,i=n.data;if(!r&&!i)return!0;if(!r||!i)return!1;if(r===i)return!0;if(r.length!==i.length)return!1;for(let e=0;e<r.length;e++)if(r[e]!==i[e])return!1;return!0})&&this.metrics.duplicates++}catch{}let r=this.msp.callbacks?.length??0;r>this.metrics.queuePeakSize&&(this.metrics.queuePeakSize=r),this._checkAlerts()}_trackResponse(){}_trackRequestCompletion(e){if(!e)return;let t=performance.now()-e.start;if(this.metrics.responseTimes.push(t),this.metrics.responseTimes.length>100&&this.metrics.responseTimes.shift(),t>this.metrics.maxResponseTime&&(this.metrics.maxResponseTime=t),this.metrics.avgResponseTime=this.metrics.responseTimes.reduce((e,t)=>e+t,0)/this.metrics.responseTimes.length,e.attempts>1&&(this.metrics.timeouts+=e.attempts-1),e.success===!1){this.metrics.failedRequests++;let t=e.errorType||`unknown`,n=this.metrics.errorsByType.get(t)||0;this.metrics.errorsByType.set(t,n+1)}else this.metrics.completedRequests++;this._checkAlerts()}_checkAlerts(){let e=this.msp.callbacks?.length??0,t=this.alerts.queueFull;this.alerts.queueFull=e>this.thresholds.maxQueueSize;let n=this.metrics.totalRequests>0?this.metrics.timeouts/this.metrics.totalRequests:0,r=this.alerts.highTimeout;this.alerts.highTimeout=n>this.thresholds.maxTimeoutRate;let i=this.alerts.slowResponses;this.alerts.slowResponses=this.metrics.avgResponseTime>this.thresholds.maxAvgResponseTime;let a=this.alerts.memoryLeak;this.alerts.memoryLeak=e>this.thresholds.memoryLeakThreshold,this.alerts.queueFull!==t&&this.alerts.queueFull&&console.warn(`🚨 Queue Full Alert: size ${e}/${this.thresholds.maxQueueSize}`),this.alerts.highTimeout!==r&&this.alerts.highTimeout&&console.warn(`⏱️ High Timeout Alert: rate ${(n*100).toFixed(1)}%`),this.alerts.slowResponses!==i&&this.alerts.slowResponses&&console.warn(`🐌 Slow Response Alert: avg ${this.metrics.avgResponseTime}ms`),this.alerts.memoryLeak!==a&&this.alerts.memoryLeak&&console.warn(`💾 Memory Leak Alert: callbacks ${e}`),this._notifyListeners()}startMonitoring(e=1e3){this.isMonitoring||(this.isMonitoring=!0,this.monitoringInterval=setInterval(()=>{this._collectMetrics(),this._notifyListeners()},e),console.log(`MSP Queue Monitor started`))}stopMonitoring(){this.isMonitoring&&(this.isMonitoring=!1,this.monitoringInterval&&=(clearInterval(this.monitoringInterval),null),console.log(`MSP Queue Monitor stopped`))}_collectMetrics(){this.currentQueueSize=this.msp.callbacks.length,this.metrics.successRate=this.metrics.totalRequests>0?this.metrics.completedRequests/this.metrics.totalRequests:0,this.metrics.timeoutRate=this.metrics.totalRequests>0?this.metrics.timeouts/this.metrics.totalRequests:0}getStatus(){return{isMonitoring:this.isMonitoring,currentQueueSize:this.msp.callbacks.length,maxQueueSize:this.msp.MAX_QUEUE_SIZE||100,metrics:{...this.metrics},alerts:{...this.alerts},queueContents:this.msp.callbacks.map(e=>({code:e.code,attempts:e.attempts||0,age:performance.now()-e.start,hasTimer:!!e.timer}))}}analyzeQueue(){let e=this.msp.callbacks,t=performance.now(),n={totalItems:e.length,byCode:{},ageDistribution:{fresh:0,recent:0,stale:0,ancient:0},retryDistribution:{firstAttempt:0,retrying:0,multipleRetries:0},potentialIssues:[]};return e.forEach(e=>{n.byCode[e.code]||(n.byCode[e.code]=0),n.byCode[e.code]++;let r=t-e.start;r<1e3?n.ageDistribution.fresh++:r<5e3?n.ageDistribution.recent++:r<1e4?n.ageDistribution.stale++:n.ageDistribution.ancient++;let i=e.attempts||0;i===0?n.retryDistribution.firstAttempt++:i===1?n.retryDistribution.retrying++:n.retryDistribution.multipleRetries++,r>1e4&&n.potentialIssues.push(`Ancient request: code ${e.code}, age ${Math.round(r/1e3)}s`),i>5&&n.potentialIssues.push(`High retry count: code ${e.code}, attempts ${i}`),e.timer||n.potentialIssues.push(`Missing timer: code ${e.code}`)}),n}addListener(e){this.listeners.push(e)}removeListener(e){let t=this.listeners.indexOf(e);t>-1&&this.listeners.splice(t,1)}_notifyListeners(){let e=this.getStatus();this.listeners.forEach(t=>{try{t(e)}catch(e){console.error(`Error in MSP monitor listener:`,e)}})}resetMetrics(){this.metrics={totalRequests:0,completedRequests:0,failedRequests:0,timeouts:0,duplicates:0,avgResponseTime:0,maxResponseTime:0,queuePeakSize:0,requestsByCode:new Map,responseTimes:[],errorsByType:new Map}}clearAlerts(){console.log(`🔄 Clearing all alerts...`),this.alerts={queueFull:!1,highTimeout:!1,slowResponses:!1,memoryLeak:!1},this._notifyListeners()}resetAll(){this.resetMetrics(),this.clearAlerts()}generateReport(){let e=this.getStatus(),t=this.analyzeQueue();return{timestamp:new Date().toISOString(),summary:{queueHealth:this._assessQueueHealth(),performanceGrade:this._calculatePerformanceGrade(),recommendations:this._generateRecommendations()},status:e,analysis:t,rawMetrics:this.metrics}}_assessQueueHealth(){let e=Object.values(this.alerts).filter(e=>e).length;return e===0?`HEALTHY`:e<=2?`WARNING`:`CRITICAL`}_calculatePerformanceGrade(){let e=100;this.metrics.timeoutRate>.1?e-=30:this.metrics.timeoutRate>.05&&(e-=15),this.metrics.avgResponseTime>2e3?e-=25:this.metrics.avgResponseTime>1e3&&(e-=10);let t=(this.currentQueueSize||(this.msp.callbacks?.length??0))/(this.msp.MAX_QUEUE_SIZE||100);return t>.8?e-=20:t>.6&&(e-=10),(this.metrics.totalRequests>0?this.metrics.failedRequests/this.metrics.totalRequests:0)>.05&&(e-=15),e>=90?`A`:e>=80?`B`:e>=70?`C`:e>=60?`D`:`F`}_generateRecommendations(){let e=[];return this.alerts.queueFull&&e.push(`Queue is near capacity. Consider implementing request prioritization or increasing queue size.`),this.alerts.highTimeout&&e.push(`High timeout rate detected. Check serial connection stability or increase timeout values.`),this.alerts.slowResponses&&e.push(`Slow response times detected. Investigate flight controller performance or reduce request frequency.`),this.alerts.memoryLeak&&e.push(`Potential memory leak detected. Check that all requests are being properly cleaned up.`),this.metrics.maxResponseTime>5e3&&e.push(`Some requests are taking very long to complete. Consider implementing request timeouts.`),e}triggerTestAlerts(){console.log(`🧪 Triggering test alerts...`);let e={...this.alerts};return this.alerts.queueFull=!0,this.alerts.highTimeout=!0,this.alerts.slowResponses=!0,this.alerts.memoryLeak=!0,console.log(`🚨 Test alerts triggered:`,this.alerts),this._notifyListeners(),setTimeout(()=>{this.alerts=e,console.log(`✅ Test alerts reset`),this._notifyListeners()},1e4),this.alerts}setTestThresholds(){console.log(`🎯 Setting test thresholds for easier alert triggering...`),this.thresholds={maxQueueSize:1,maxAvgResponseTime:100,maxTimeoutRate:.01,memoryLeakThreshold:5},console.log(`New thresholds:`,this.thresholds)}setNormalThresholds(){console.log(`🔧 Resetting to normal thresholds...`),this.thresholds={maxQueueSize:Math.floor((this.msp.MAX_QUEUE_SIZE||100)*.8),maxAvgResponseTime:2e3,maxTimeoutRate:.1,memoryLeakThreshold:100},console.log(`Normal thresholds restored:`,this.thresholds)}destroy(){this.stopMonitoring(),this.originalSendMessage&&(this.msp.send_message=this.originalSendMessage),this.originalDispatchMessage&&(this.msp._dispatch_message=this.originalDispatchMessage),this.originalRemoveRequest&&(this.msp._removeRequestFromCallbacks=this.originalRemoveRequest),this.msp._mspQueueMonitorInstrumented=void 0,this.listeners=[],n=null}},n=null,r={get instance(){if(!n){if(typeof window>`u`||!window.MSP)throw Error(`MSP Queue Monitor: window.MSP is not available. Make sure MSP is loaded before using the monitor.`);n=new t(window.MSP)}return n},startMonitoring(...e){return this.instance.startMonitoring(...e)},stopMonitoring(...e){return this.instance.stopMonitoring(...e)},getStatus(...e){return this.instance.getStatus(...e)},analyzeQueue(...e){return this.instance.analyzeQueue(...e)},addListener(...e){return this.instance.addListener(...e)},removeListener(...e){return this.instance.removeListener(...e)},resetMetrics(...e){return this.instance.resetMetrics(...e)},clearAlerts(...e){return this.instance.clearAlerts(...e)},resetAll(...e){return this.instance.resetAll(...e)},generateReport(...e){return this.instance.generateReport(...e)},triggerTestAlerts(...e){return this.instance.triggerTestAlerts(...e)},setTestThresholds(...e){return this.instance.setTestThresholds(...e)},setNormalThresholds(...e){return this.instance.setNormalThresholds(...e)},destroy(...e){return this.instance.destroy(...e)},get isMonitoring(){return this.instance.isMonitoring},get metrics(){return this.instance.metrics},get alerts(){return this.instance.alerts},get thresholds(){return this.instance.thresholds}},i=class{constructor(e){this.msp=e,this.monitor=r,this.isRunning=!1,this.testResults=[],this.currentTest=null,this.testCodes={MSP_IDENT:100,MSP_STATUS:101,MSP_RAW_IMU:102,MSP_SERVO:103,MSP_MOTOR:104,MSP_RC:105,MSP_RAW_GPS:106,MSP_COMP_GPS:107,MSP_ATTITUDE:108,MSP_ALTITUDE:109,MSP_ANALOG:110,MSP_RC_TUNING:111,MSP_PID:112,MSP_PIDNAMES:116,MSP_BOXNAMES:117,MSP_MISC:114,MSP_MOTOR_PINS:115}}getTestStatus(e){return!e||typeof e!=`object`||e.error||e.memoryLeakDetected===!0||e.overflowHandled===!1||e.timeoutOccurred===!0&&e.recoveryTime>2e3||e.recoverySuccessful===!1||e.failed&&e.failed>0||e.duplicateRejections&&e.duplicateRejections>0||e.leaked&&e.leaked>0||e.failedWhileDisconnected&&e.failedWhileDisconnected>0&&e.recoverySuccessful===!1?`FAILED`:`PASSED`}async runStressTestSuite(){console.log(`🚀 Starting MSP Stress Test Suite`),this.isRunning=!0,this.monitor.startMonitoring(100);let e=[{name:`Queue Flooding`,test:()=>this.testQueueFlooding()},{name:`Rapid Fire Requests`,test:()=>this.testRapidFireRequests()},{name:`Duplicate Request Handling`,test:()=>this.testDuplicateRequests()},{name:`Timeout Recovery`,test:()=>this.testTimeoutRecovery()},{name:`Memory Leak Detection`,test:()=>this.testMemoryLeaks()},{name:`Concurrent Mixed Requests`,test:()=>this.testConcurrentMixedRequests()},{name:`Queue Overflow Handling`,test:()=>this.testQueueOverflow()},{name:`Connection Disruption`,test:()=>this.testConnectionDisruption()},{name:`Performance Under Load`,test:()=>this.testPerformanceUnderLoad()}],t=[];try{for(let n of e)try{console.log(`\n📋 Running: ${n.name}`),this.currentTest=n.name,this.monitor.resetAll();let e=performance.now(),r=await n.test(),i=performance.now()-e,a={name:n.name,status:this.getTestStatus(r),duration:i,result:r,metrics:this.monitor.getStatus(),timestamp:new Date().toISOString()};t.push(a),console.log(`✅ ${n.name} completed in ${Math.round(i)}ms`),await this.wait(1e3)}catch(e){console.error(`❌ ${n.name} failed:`,e),t.push({name:n.name,status:`FAILED`,error:e.message,timestamp:new Date().toISOString()})}this.testResults=t;let n=this.generateTestReport(t);return console.log(`
📊 Stress Test Suite Complete`),console.log(n.summary),n}finally{this.monitor.stopMonitoring(),this.isRunning=!1,this.currentTest=null}}async testQueueFlooding(){let e=[];console.log(`  Flooding queue with 110 requests...`);for(let t=0;t<110;t++){let n=Object.values(this.testCodes)[t%Object.keys(this.testCodes).length],r=this.msp.promise(n,null).catch(e=>({error:e.message}));e.push(r)}let t=await Promise.allSettled(e),n=t.filter(e=>e.status===`fulfilled`&&!(e.value&&e.value.error)).length;return{requestsSent:110,successful:n,failed:t.length-n,successRate:n/110,peakQueueSize:(this.monitor.getStatus().metrics||{}).queuePeakSize??0}}async testRapidFireRequests(){console.log(`  Sending 20 requests with 10ms intervals...`);let e=[],t=[],n=performance.now();for(let n=0;n<20;n++){let r=this.testCodes.MSP_STATUS,i=performance.now();t.push(i);let a=this.msp.promise(r,null).then(()=>({success:!0,responseTime:performance.now()-i,index:n})).catch(e=>({success:!1,error:e.message,responseTime:performance.now()-i,index:n}));e.push(a),n<19&&await this.wait(10)}let r=await Promise.allSettled(e),i=performance.now()-n,a=r.map(e=>e.status===`fulfilled`?e.value:{success:!1,error:e.reason?.message||`Unknown error`,responseTime:0,index:-1}),o=a.filter(e=>e.success).length,s=a.map(e=>e.responseTime).filter(e=>e>0),c=s.length>0?s.reduce((e,t)=>e+t,0)/s.length:0;return{requestCount:20,successful:o,failed:20-o,totalTime:i,avgResponseTime:c,throughput:20/(i/1e3),concurrentRequests:!0,maxConcurrentRequests:20}}async testDuplicateRequests(){let e=this.testCodes.MSP_IDENT,t=new Uint8Array([1,2,3]);console.log(`  Sending 5 duplicate requests...`);let n=[];for(let r=0;r<5;r++)n.push(this.msp.promise(e,t).catch(e=>({error:e.message})));let r=await Promise.allSettled(n);return{duplicatesSent:5,successful:r.filter(e=>e.status===`fulfilled`&&!(e.value&&e.value.error)).length,duplicateRejections:r.filter(e=>e.status===`rejected`||e.value&&e.value.error&&e.value.error.includes(`duplicate`)).length,queueSizeAfter:this.msp.callbacks.length}}async testTimeoutRecovery(){console.log(`  Testing timeout recovery...`);let e=this.msp.TIMEOUT;this.msp.TIMEOUT=100;try{let t=this.testCodes.MSP_STATUS,n=performance.now();try{return await this.msp.promise(t,null),{error:`Expected timeout but request succeeded`}}catch{let t=performance.now()-n;this.msp.TIMEOUT=e,await this.wait(200);let r=performance.now();return await this.msp.promise(this.testCodes.MSP_IDENT,null),{timeoutOccurred:!0,timeoutDuration:t,recoveryTime:performance.now()-r,queueCleanedUp:this.msp.callbacks.length===0}}}finally{this.msp.TIMEOUT=e}}async testMemoryLeaks(){console.log(`  Testing for memory leaks...`);let e=this.msp.callbacks.length,t=[];for(let e=0;e<10;e++)t.push(this.msp.promise(this.testCodes.MSP_STATUS,null).catch(()=>{}));await Promise.allSettled(t),await this.wait(100);let n=this.msp.callbacks.length,r=n-e;return{initialCallbacks:e,finalCallbacks:n,leaked:r,memoryLeakDetected:r>0,requestsProcessed:10}}async testConcurrentMixedRequests(){console.log(`  Testing concurrent mixed requests...`);let e=[],t=Object.values(this.testCodes);for(let n=0;n<15;n++){let r=t[n%t.length],i=n%3==0?new Uint8Array([n]):null;e.push(this.msp.promise(r,i).catch(e=>({error:e.message})))}let n=performance.now(),r=await Promise.allSettled(e),i=performance.now()-n,a=r.filter(e=>e.status===`fulfilled`&&!(e.value&&e.value.error)).length;return{totalRequests:e.length,successful:a,failed:e.length-a,totalTime:i,concurrentProcessing:!0}}async testQueueOverflow(){console.log(`  Testing queue overflow handling...`);let e=this.msp.MAX_QUEUE_SIZE||100,t=e+10,n=[];for(let e=0;e<t;e++)n.push(this.msp.promise(this.testCodes.MSP_STATUS,null).catch(e=>({error:e.message})));let r=(await Promise.allSettled(n)).filter(e=>e.status===`rejected`||e.value?.error).length;return{attemptedRequests:t,maxQueueSize:e,rejectedDueToOverflow:r,overflowHandled:r>0,finalQueueSize:this.msp.callbacks.length}}async testConnectionDisruption(){console.log(`  Simulating connection disruption...`);let e=this.msp.serial?.connected;try{this.msp.serial&&(this.msp.serial.connected=!1);let t=[];for(let e=0;e<5;e++)t.push(this.msp.promise(this.testCodes.MSP_STATUS,null).catch(e=>({error:e.message})));let n=(await Promise.allSettled(t)).filter(e=>e.status===`rejected`||e.value?.error).length;return this.msp.serial&&(this.msp.serial.connected=e),await this.wait(100),{failedWhileDisconnected:n,recoverySuccessful:!(await this.msp.promise(this.testCodes.MSP_IDENT,null).catch(e=>({error:e.message}))).error,connectionHandled:n>0}}finally{this.msp.serial&&(this.msp.serial.connected=e)}}async testPerformanceUnderLoad(){console.log(`  Testing performance under sustained load...`);let e=5e3,t=performance.now(),n=[],r=0,i=[],a=t;for(;performance.now()-t<e;){let e=performance.now();r++;let t=this.msp.promise(this.testCodes.MSP_STATUS,null).then(()=>({success:!0,responseTime:performance.now()-e})).catch(t=>({success:!1,responseTime:performance.now()-e,error:t.message}));i.push(t);let o=performance.now();(i.length>=10||o-a>=200)&&((await Promise.allSettled(i)).forEach(e=>{e.status===`fulfilled`?n.push(e.value):n.push({success:!1,responseTime:0,error:e.reason?.message||`Unknown error`})}),i=[],a=o),await this.wait(20)}i.length>0&&(await Promise.allSettled(i)).forEach(e=>{e.status===`fulfilled`?n.push(e.value):n.push({success:!1,responseTime:0,error:e.reason?.message||`Unknown error`})});let o=n.filter(e=>e.success).length,s=n.map(e=>e.responseTime).filter(e=>e>0),c=s.length>0?s.reduce((e,t)=>e+t,0)/s.length:0,l=s.length>0?Math.max(...s):0;return{duration:e,requestCount:r,successful:o,failed:r-o,successRate:o/r,avgResponseTime:c,maxResponseTime:l,throughput:r/(e/1e3),concurrentRequests:!0,batchSize:10,maxConcurrentRequests:10}}generateTestReport(e){let t=e.length,n=e.filter(e=>e.status===`PASSED`).length,r={totalTests:t,passed:n,failed:t-n,successRate:n/t,overallGrade:this._calculateOverallGrade(e)},i=this._generateTestRecommendations(e);return{timestamp:new Date().toISOString(),summary:r,recommendations:i,detailedResults:e,monitorReport:this.monitor.generateReport()}}_calculateOverallGrade(e){let t=e.filter(e=>e.status===`PASSED`).length/e.length;return t>=.95?`A+`:t>=.9?`A`:t>=.85?`B+`:t>=.8?`B`:t>=.75?`C+`:t>=.7?`C`:t>=.6?`D`:`F`}_generateTestRecommendations(e){let t=[],n=e.filter(e=>e.status===`FAILED`);return n.length>0&&t.push(`${n.length} tests failed. Review implementation for: ${n.map(e=>e.name).join(`, `)}`),e.find(e=>e.name===`Performance Under Load`)?.result?.avgResponseTime>1e3&&t.push(`Average response time is high. Consider optimizing MSP request handling.`),e.find(e=>e.name===`Memory Leak Detection`)?.result?.memoryLeakDetected&&t.push(`Memory leak detected. Ensure all callbacks are properly cleaned up.`),e.find(e=>e.name===`Queue Overflow Handling`)?.result?.overflowHandled||t.push(`Queue overflow not properly handled. Implement proper queue management.`),t}wait(e){return new Promise(t=>setTimeout(t,e))}async runSpecificTest(e){let t={"queue-flooding":()=>this.testQueueFlooding(),"rapid-fire":()=>this.testRapidFireRequests(),duplicates:()=>this.testDuplicateRequests(),"timeout-recovery":()=>this.testTimeoutRecovery(),"memory-leaks":()=>this.testMemoryLeaks(),"concurrent-mixed":()=>this.testConcurrentMixedRequests(),"queue-overflow":()=>this.testQueueOverflow(),"connection-disruption":()=>this.testConnectionDisruption(),"performance-load":()=>this.testPerformanceUnderLoad()}[e];if(!t)throw Error(`Unknown test: ${e}`);console.log(`🧪 Running specific test: ${e}`),this.monitor.startMonitoring(100),this.monitor.resetAll();try{return{name:e,status:`PASSED`,result:await t(),metrics:this.monitor.getStatus()}}catch(t){return{name:e,status:`FAILED`,error:t.message}}finally{this.monitor.stopMonitoring()}}destroy(){this.monitor.isMonitoring&&this.monitor.stopMonitoring()}},a=null,o={get instance(){if(!a){if(typeof window>`u`||!window.MSP)throw Error(`MSP Stress Test: window.MSP is not available. Make sure MSP is loaded before using the stress test.`);a=new i(window.MSP)}return a},runStressTestSuite(...e){return this.instance.runStressTestSuite(...e)},runSpecificTest(...e){return this.instance.runSpecificTest(...e)},generateTestReport(...e){return this.instance.generateTestReport(...e)},wait(...e){return this.instance.wait(...e)},destroy(...e){return this.instance.destroy(...e)},testQueueFlooding(...e){return this.instance.testQueueFlooding(...e)},testRapidFireRequests(...e){return this.instance.testRapidFireRequests(...e)},testDuplicateRequests(...e){return this.instance.testDuplicateRequests(...e)},testTimeoutRecovery(...e){return this.instance.testTimeoutRecovery(...e)},testMemoryLeaks(...e){return this.instance.testMemoryLeaks(...e)},testConcurrentMixedRequests(...e){return this.instance.testConcurrentMixedRequests(...e)},testQueueOverflow(...e){return this.instance.testQueueOverflow(...e)},testConnectionDisruption(...e){return this.instance.testConnectionDisruption(...e)},testPerformanceUnderLoad(...e){return this.instance.testPerformanceUnderLoad(...e)},get monitor(){return this.instance.monitor},get isRunning(){return this.instance.isRunning},get testResults(){return this.instance.testResults},get currentTest(){return this.instance.currentTest},get testCodes(){return this.instance.testCodes}},s=new class{constructor(){this.isVisible=!1,this.updateInterval=null,this.chartData={queueSize:[],responseTime:[],timestamps:[]},this.maxDataPoints=50,this.updatesPaused=!1,this.pauseTimeout=null,this.lastUpdateData={},this.lastChartUpdate=0,this.chartUpdatePending=!1,this.elementCache=new Map,this.createDashboard(),this.setupEventListeners()}escapeHtml(e){if(typeof e!=`string`)return e;let t=document.createElement(`div`);return t.textContent=e,t.innerHTML}createDashboard(){this.container=document.createElement(`div`),this.container.id=`msp-debug-dashboard`,this.container.innerHTML=`
            <div class="msp-dashboard-header">
                <h3>🔧 MSP Debug Dashboard</h3>
                <div class="dashboard-controls">
                    <button id="msp-toggle-monitoring">Start Monitoring</button>
                    <button id="msp-run-stress-test">Run Stress Test</button>
                    <button id="msp-clear-metrics">Clear Metrics</button>
                    <button id="msp-close-dashboard">×</button>
                </div>
                <div id="updates-status" class="updates-status" style="display: none;">⏸️ Updates Paused</div>
            </div>
            
            <div class="msp-dashboard-content">
                <!-- Status Overview -->
                <div class="status-section">
                    <h4>📊 Status Overview</h4>
                    <div class="status-grid">
                        <div class="status-item">
                            <label>Queue Size:</label>
                            <span id="queue-size" class="value">0</span>
                            <span class="max-value">/ <span id="max-queue-size">50</span></span>
                        </div>
                        <div class="status-item">
                            <label>Success Rate:</label>
                            <span id="success-rate" class="value">100%</span>
                        </div>
                        <div class="status-item">
                            <label>Avg Response:</label>
                            <span id="avg-response-time" class="value">0ms</span>
                        </div>
                        <div class="status-item">
                            <label>Total Requests:</label>
                            <span id="total-requests" class="value">0</span>
                        </div>
                    </div>
                </div>
                
                <!-- Alerts Section -->
                <div class="alerts-section">
                    <h4>🚨 Alerts</h4>
                    <div class="alerts-header">
                        <button id="clear-alerts" style="float: right; padding: 2px 6px; font-size: 10px; background: #666; color: white; border: none; border-radius: 2px; cursor: pointer;">Clear Alerts</button>
                    </div>
                    <div id="alerts-container" class="alerts-container">
                        <div class="no-alerts">No active alerts</div>
                    </div>
                </div>
                
                <!-- Queue Analysis -->
                <div class="queue-section">
                    <h4>📋 Queue Analysis</h4>
                    <div class="queue-controls">
                        <button id="analyze-queue">Analyze Current Queue</button>
                        <button id="export-report">Export Report</button>
                    </div>
                    <div id="queue-analysis" class="queue-analysis"></div>
                </div>
                
                <!-- Live Chart -->
                <div class="chart-section">
                    <h4>📈 Live Metrics</h4>
                    <canvas id="msp-metrics-chart"></canvas>
                </div>
                
                <!-- Request Details -->
                <div class="details-section">
                    <h4>🔍 Current Queue Contents</h4>
                    <div id="queue-contents" class="queue-contents"></div>
                </div>
                
                <!-- Test Results -->
                <div class="test-section">
                    <h4>🧪 Test Results</h4>
                    <div id="test-results" class="test-results"></div>
                </div>
            </div>
        `,this.addStyles(),document.body.appendChild(this.container),this.container.style.display=`none`}addStyles(){let e=document.createElement(`style`);e.textContent=`
            #msp-debug-dashboard {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 500px;
                max-height: 80vh;
                background: #1e1e1e;
                color: #ffffff;
                border: 1px solid #444;
                border-radius: 8px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                z-index: 10000;
                overflow-y: auto;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            }
            
            .msp-dashboard-header {
                background: #2d2d2d;
                padding: 10px 15px;
                border-bottom: 1px solid #444;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .msp-dashboard-header h3 {
                margin: 0;
                font-size: 14px;
            }
            
            .dashboard-controls {
                display: flex;
                gap: 5px;
            }
            
            .dashboard-controls button {
                padding: 4px 8px;
                font-size: 11px;
                background: #444;
                color: white;
                border: 1px solid #666;
                border-radius: 3px;
                cursor: pointer;
            }
            
            .dashboard-controls button:hover {
                background: #555;
            }
            
            .updates-status {
                position: absolute;
                top: 50%;
                right: 160px;
                transform: translateY(-50%);
                font-size: 11px;
                color: #ffaa00;
                background: rgba(255, 170, 0, 0.15);
                padding: 3px 8px;
                border-radius: 3px;
                border: 1px solid #ffaa00;
                font-weight: bold;
                z-index: 10001;
            }
            
            .msp-dashboard-content {
                padding: 15px;
            }
            
            .status-section, .alerts-section, .queue-section, .chart-section, .details-section, .test-section {
                margin-bottom: 20px;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 10px;
            }
            
            .status-section h4, .alerts-section h4, .queue-section h4, .chart-section h4, .details-section h4, .test-section h4 {
                margin: 0 0 10px 0;
                font-size: 13px;
                color: #ffd700;
            }
            
            .status-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            
            .status-item {
                background: #2a2a2a;
                padding: 8px;
                border-radius: 3px;
            }
            
            .status-item label {
                display: block;
                font-size: 11px;
                color: #ccc;
                margin-bottom: 3px;
            }
            
            .status-item .value {
                font-weight: bold;
                color: #00ff00;
            }
            
            .max-value {
                color: #888;
                font-size: 10px;
            }
            
            .alerts-container {
                min-height: 30px;
            }
            
            .alert-item {
                background: #ff4444;
                color: white;
                padding: 5px 10px;
                border-radius: 3px;
                margin-bottom: 5px;
                font-size: 11px;
            }
            
            .alert-item.warning {
                background: #ffaa00;
            }
            
            .no-alerts {
                color: #888;
                font-style: italic;
                text-align: center;
                padding: 10px;
            }
            
            .queue-controls {
                margin-bottom: 10px;
            }
            
            .queue-controls button {
                padding: 5px 10px;
                margin-right: 5px;
                background: #0066cc;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
            }
            
            .queue-controls button:hover {
                background: #0088ff;
            }
            
            .queue-analysis {
                background: #2a2a2a;
                padding: 10px;
                border-radius: 3px;
                font-size: 11px;
                max-height: 200px;
                overflow-y: auto;
                pointer-events: auto; /* Ensure clickability */
            }
            
            .queue-contents {
                background: #2a2a2a;
                padding: 10px;
                border-radius: 3px;
                max-height: 150px;
                overflow-y: auto;
                pointer-events: auto; /* Ensure clickability */
            }
            
            .queue-item {
                display: flex;
                justify-content: space-between;
                padding: 3px 0;
                border-bottom: 1px solid #333;
                font-size: 11px;
            }
            
            .queue-item:last-child {
                border-bottom: none;
            }
            
            .queue-item-empty {
                opacity: 0.3;
                font-style: italic;
            }
            
            .test-results {
                background: #2a2a2a;
                padding: 10px;
                border-radius: 3px;
                max-height: 200px;
                overflow-y: auto;
                font-size: 11px;
                pointer-events: auto; /* Ensure clickability */
            }
            
            .test-result-item {
                display: flex;
                justify-content: space-between;
                padding: 5px 0;
                border-bottom: 1px solid #333;
                cursor: pointer;
                min-height: 20px; /* Prevent height changes during updates */
            }
            
            .test-result-item:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            .test-result-item:last-child {
                border-bottom: none;
            }
            
            .test-passed {
                color: #00ff00;
            }
            
            .test-failed {
                color: #ff4444;
            }
            
            #msp-metrics-chart {
                width: 100%;
                height: 150px;
                background: #2a2a2a;
                border-radius: 3px;
                display: block;
            }
            
            .test-result-item {
                padding: 5px 10px;
                margin: 2px 0;
                border-radius: 3px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #1a1a1a;
                border: 1px solid #444;
                transition: all 0.2s ease;
                user-select: none;
            }
            
            .test-result-item:hover {
                background: #333 !important;
                border-color: #666;
                transform: translateX(2px);
            }
            
            .test-result-item:active {
                background: #444 !important;
                transform: translateX(0px);
            }
            
            .queue-item {
                padding: 5px;
                margin: 2px 0;
                background: #1a1a1a;
                border-radius: 3px;
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                border: 1px solid #333;
            }
            
            .alert-item {
                padding: 5px 10px;
                margin: 2px 0;
                background: #4a2a2a;
                border-radius: 3px;
                border-left: 3px solid #ff4444;
                color: #ffcccc;
            }
            
            #updates-status {
                position: absolute;
                top: 5px;
                right: 50px;
                background: rgba(255, 165, 0, 0.9);
                color: #000;
                padding: 2px 8px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                display: none;
                z-index: 1001;
            }
        `,document.head.appendChild(e)}setupEventListeners(){this.container.addEventListener(`click`,e=>{if(e.target.id===`msp-toggle-monitoring`)this.toggleMonitoring();else if(e.target.id===`msp-run-stress-test`)this.runStressTest();else if(e.target.id===`msp-clear-metrics`)this.clearMetrics();else if(e.target.id===`clear-alerts`)this.clearAlerts();else if(e.target.id===`msp-close-dashboard`)this.hide();else if(e.target.id===`analyze-queue`)this.analyzeQueue();else if(e.target.id===`export-report`)this.exportReport();else{let t=e.target.closest(`.test-result-item`);if(t){let e=parseInt(t.getAttribute(`data-test-index`),10);isNaN(e)||this.showTestDetails(e)}if(e.target.classList.contains(`close-details-btn`)){let t=e.target.closest(`.test-details`);t&&(t.remove(),this.pauseUpdates(1e3))}}}),this.setupInteractionHandlers(),r.addListener(e=>{this.updateDisplay(e)}),document.addEventListener(`keydown`,e=>{e.ctrlKey&&e.shiftKey&&e.key===`M`&&this.toggle()}),window.addEventListener(`resize`,()=>{this.isVisible&&setTimeout(()=>this.drawChart(),100)})}show(){this.container.style.display=`block`,this.isVisible=!0,this.updateDisplay()}hide(){this.container.style.display=`none`,this.isVisible=!1}toggle(){this.isVisible?this.hide():this.show()}setupInteractionHandlers(){let e=[`.test-results`,`.queue-analysis`,`.test-result-item`,`button`,`select`,`input`,`.queue-item`,`.alert-item`];e.forEach(e=>{this.container.addEventListener(`mouseenter`,t=>{(t.target.matches(e)||t.target.closest(e))&&this.pauseUpdates(3e3)},!0)}),this.container.addEventListener(`click`,t=>{e.some(e=>t.target.matches(e)||t.target.closest(e))&&this.pauseUpdates(5e3)}),this.container.addEventListener(`focusin`,e=>{e.target.matches(`input, select, textarea, button`)&&this.pauseUpdates(1e4)}),this.container.addEventListener(`focusout`,e=>{this.container.contains(e.relatedTarget)||this.pauseUpdates(1e3)}),this.container.addEventListener(`mouseenter`,e=>{let t=e.target.closest(`.test-result-item`);t&&(t.style.backgroundColor=`#333`,this.pauseUpdates(2e3))},!0),this.container.addEventListener(`mouseleave`,e=>{let t=e.target.closest(`.test-result-item`);t&&(t.style.backgroundColor=``)},!0)}toggleMonitoring(){let e=document.getElementById(`msp-toggle-monitoring`);r.isMonitoring?(r.stopMonitoring(),e.textContent=`Start Monitoring`,e.style.background=`#444`):(r.startMonitoring(500),e.textContent=`Stop Monitoring`,e.style.background=`#00aa00`)}async runStressTest(){let e=document.getElementById(`msp-run-stress-test`),t=e.textContent;e.textContent=`Running Tests...`,e.disabled=!0;try{let e=await o.runStressTestSuite();this.displayTestResults(e)}catch(e){console.error(`Stress test failed:`,e),this.displayTestResults({summary:{failed:1,error:e.message},detailedResults:[]})}finally{e.textContent=t,e.disabled=!1}}clearMetrics(){r.resetMetrics(),this.chartData={queueSize:[],responseTime:[],timestamps:[]},this.updateDisplay()}clearAlerts(){r.clearAlerts()}updateDisplay(e=null){!this.isVisible||this.updatesPaused||(e||=r.getStatus(),this._hasDataChanged(e)&&(this._updateStatusMetrics(e),this._updateAlertsIfChanged(e.alerts),this._updateQueueContentsIfChanged(e.queueContents),this._updateChart(e),this.lastUpdateData={currentQueueSize:e.currentQueueSize,totalRequests:e.metrics.totalRequests,successRate:e.metrics.successRate,avgResponseTime:e.metrics.avgResponseTime,alerts:JSON.stringify(e.alerts),queueContents:JSON.stringify(e.queueContents)}))}_hasDataChanged(e){let t=this.lastUpdateData;if(!t||t.currentQueueSize!==e.currentQueueSize||t.totalRequests!==e.metrics.totalRequests||t.successRate!==e.metrics.successRate||t.avgResponseTime!==e.metrics.avgResponseTime)return!0;try{let n=JSON.stringify(e.alerts),r=JSON.stringify(e.queueContents);return t.alerts!==n||t.queueContents!==r}catch(e){return console.warn(`JSON stringify failed in dashboard update check:`,e),!0}}_updateStatusMetrics(e){this.updateElement(`queue-size`,e.currentQueueSize),this.updateElement(`max-queue-size`,e.maxQueueSize),this.updateElement(`success-rate`,`${Math.round((e.metrics.successRate||0)*100)}%`),this.updateElement(`avg-response-time`,`${Math.round(e.metrics.avgResponseTime||0)}ms`),this.updateElement(`total-requests`,e.metrics.totalRequests)}_updateAlertsIfChanged(e){let t=JSON.stringify(e);this.lastUpdateData.alerts!==t&&this.updateAlerts(e)}_updateQueueContentsIfChanged(e){let t=JSON.stringify(e);this.lastUpdateData.queueContents!==t&&this.updateQueueContents(e)}pauseUpdates(e=2e3){this.updatesPaused=!0;let t=document.getElementById(`updates-status`);t&&(t.style.display=`block`),this.pauseTimeout&&clearTimeout(this.pauseTimeout),this.pauseTimeout=setTimeout(()=>{this.updatesPaused=!1,t&&(t.style.display=`none`),this.updateDisplay()},e)}updateElement(e,t){let n=this.elementCache.get(e);n||(n=document.getElementById(e),n&&this.elementCache.set(e,n)),n&&n.textContent!==t&&(n.textContent=t)}updateAlerts(e){let t=document.getElementById(`alerts-container`);if(!t)return;let n=Object.entries(e).filter(([e,t])=>t);if(n.length===0){t.innerHTML=`<div class="no-alerts">No active alerts</div>`;return}let r={queueFull:`Queue is near capacity`,highTimeout:`High timeout rate detected`,slowResponses:`Slow response times detected`,memoryLeak:`Potential memory leak detected`};t.innerHTML=n.map(([e,t])=>`<div class="alert-item">${r[e]||this.escapeHtml(e)}</div>`).join(``)}updateQueueContents(e){let t=document.getElementById(`queue-contents`);if(!t)return;let n=e||[],r=[];for(let e=0;e<5;e++)if(e<n.length){let t=n[e];r.push(`
                    <div class="queue-item">
                        <span>Code: ${this.escapeHtml(t.code)}</span>
                        <span>Age: ${Math.round(t.age)}ms</span>
                        <span>Attempts: ${this.escapeHtml(t.attempts)}</span>
                        <span style="color: ${t.hasTimer?`#00ff00`:`#ff4444`}">${t.hasTimer?`✓`:`✗`}</span>
                    </div>
                `)}else r.push(`
                    <div class="queue-item queue-item-empty">
                        <span style="color: #555;">—</span>
                        <span style="color: #555;">—</span>
                        <span style="color: #555;">—</span>
                        <span style="color: #555;">—</span>
                    </div>
                `);t.innerHTML=r.join(``)}_updateChart(e){this.updateChart(e)}updateChart(e){let t=Date.now();this.lastChartUpdate&&t-this.lastChartUpdate<200||(this.chartData.timestamps.push(t),this.chartData.queueSize.push(e.currentQueueSize),this.chartData.responseTime.push(e.metrics.avgResponseTime||0),this.chartData.timestamps.length>this.maxDataPoints&&(this.chartData.timestamps.shift(),this.chartData.queueSize.shift(),this.chartData.responseTime.shift()),this.lastChartUpdate=t,this.chartUpdatePending||(this.chartUpdatePending=!0,requestAnimationFrame(()=>{this.drawChart(),this.chartUpdatePending=!1})))}drawChart(){let e=document.getElementById(`msp-metrics-chart`);if(!e)return;let t=e.getContext(`2d`),n=e.getBoundingClientRect(),r=n.width,i=n.height,a=window.devicePixelRatio||1;e.width=r*a,e.height=i*a,e.style.width=`${r}px`,e.style.height=`${i}px`,t.scale(a,a);let o=r,s=i;if(t.fillStyle=`#2a2a2a`,t.fillRect(0,0,o,s),this.chartData.timestamps.length<2)return;t.strokeStyle=`#00ff00`,t.lineWidth=2,t.beginPath();let c=Math.max(...this.chartData.queueSize,10);this.chartData.queueSize.forEach((e,n)=>{let r=n/(this.chartData.queueSize.length-1)*o,i=s-e/c*s;n===0?t.moveTo(r,i):t.lineTo(r,i)}),t.stroke(),t.fillStyle=`#ffffff`,t.font=`10px monospace`,t.fillText(`Queue Size`,5,15),t.fillText(`Max: ${c}`,5,s-5)}analyzeQueue(){let e=r.analyzeQueue(),t=document.getElementById(`queue-analysis`);t&&(t.innerHTML=`
            <div><strong>Total Items:</strong> ${e.totalItems}</div>
            <div><strong>Age Distribution:</strong></div>
            <div style="margin-left: 10px;">
                Fresh (&lt;1s): ${e.ageDistribution.fresh}<br>
                Recent (1-5s): ${e.ageDistribution.recent}<br>
                Stale (5-10s): ${e.ageDistribution.stale}<br>
                Ancient (&gt;10s): ${e.ageDistribution.ancient}
            </div>
            <div><strong>By Code:</strong></div>
            <div style="margin-left: 10px;">
                ${Object.entries(e.byCode).map(([e,t])=>`Code ${this.escapeHtml(String(e))}: ${t}`).join(`<br>`)}
            </div>
            ${e.potentialIssues.length>0?`
                <div><strong>Issues:</strong></div>
                <div style="margin-left: 10px; color: #ff4444;">
                    ${e.potentialIssues.map(e=>this.escapeHtml(String(e))).join(`<br>`)}
                </div>
            `:``}
        `)}displayTestResults(e){let t=document.getElementById(`test-results`);if(!t)return;let n=e.summary||{};t.innerHTML=`
            <div><strong>Test Summary:</strong></div>
            <div style="margin-left: 10px;">
                Passed: <span class="test-passed">${n.passed||0}</span><br>
                Failed: <span class="test-failed">${n.failed||0}</span><br>
                Success Rate: ${Math.round((n.successRate||0)*100)}%<br>
                Grade: ${n.overallGrade||`N/A`}
            </div>
            <div style="margin-top: 10px;"><strong>Details (click for more info):</strong></div>
            <div style="margin-left: 10px;">
                ${(e.detailedResults||[]).map((e,t)=>`
                    <div class="test-result-item" data-test-index="${t}">
                        <span class="${e.status===`PASSED`?`test-passed`:`test-failed`}">
                            ${this.escapeHtml(e.name)}
                        </span>
                        <span>${this.escapeHtml(e.status)}</span>
                    </div>
                `).join(``)}
            </div>
        `,this.lastTestResults=e}showTestDetails(e){if(!this?.lastTestResults?.detailedResults)return;let t=this.lastTestResults.detailedResults[e];if(!t)return;this.pauseUpdates(5e3);let n=`
            <div style="background: #1a1a1a; padding: 15px; border-radius: 5px; margin: 10px 0;">
                <h4 style="color: #ffd700; margin: 0 0 10px 0;">📋 ${this.escapeHtml(t.name)} Details</h4>
                <div><strong>Status:</strong> <span class="${t.status===`PASSED`?`test-passed`:`test-failed`}">${this.escapeHtml(t.status)}</span></div>
                ${t.duration?`<div><strong>Duration:</strong> ${Math.round(t.duration)}ms</div>`:``}
                ${t.error?`<div><strong>Error:</strong> <span style="color: #ff4444;">${this.escapeHtml(t.error)}</span></div>`:``}
                ${t.result?`
                    <div style="margin-top: 10px;"><strong>Results:</strong></div>
                    <pre style="background: #000; padding: 10px; border-radius: 3px; font-size: 10px; overflow-x: auto;">${this.escapeHtml(JSON.stringify(t.result,null,2))}</pre>
                `:``}
                ${t.metrics?`
                    <div style="margin-top: 10px;"><strong>Metrics:</strong></div>
                    <div style="margin-left: 10px;">
                        Queue Size: ${t.metrics.currentQueueSize}/${t.metrics.maxQueueSize}<br>
                        Total Requests: ${t.metrics.totalRequests}<br>
                        Success Rate: ${Math.round((t.metrics.successRate||0)*100)}%<br>
                        Avg Response: ${Math.round(t.metrics.avgResponseTime||0)}ms
                    </div>
                `:``}
                <button class="close-details-btn" 
                        style="margin-top: 10px; padding: 5px 10px; background: #666; color: white; border: none; border-radius: 3px; cursor: pointer;">
                    Close Details
                </button>
            </div>
        `,r=document.getElementById(`test-results`),i=r.querySelector(`.test-details`);i&&i.remove();let a=document.createElement(`div`);a.className=`test-details`,a.innerHTML=n,r.appendChild(a)}exportReport(){let e=r.generateReport(),t=new Blob([JSON.stringify(e,null,2)],{type:`application/json`}),n=URL.createObjectURL(t),i=document.createElement(`a`);i.href=n,i.download=`msp-report-${new Date().toISOString().slice(0,19).replace(/:/g,`-`)}.json`,document.body.appendChild(i),i.click(),document.body.removeChild(i),URL.revokeObjectURL(n)}};window.MSPDebug={dashboard:s,monitor:r,stressTest:o,show:()=>s.show(),hide:()=>s.hide(),startMonitoring:()=>r.startMonitoring(),stopMonitoring:()=>r.stopMonitoring(),runTests:()=>o.runStressTestSuite(),runFullSuite:()=>o.runStressTestSuite(),analyze:()=>r.analyzeQueue(),report:()=>r.generateReport(),showTestDetails:e=>s.showTestDetails(e),runTest:e=>o.runSpecificTest(e),quickHealthCheck:()=>window.MSPTestRunner?.quickHealthCheck?.(),stressScenario:e=>window.MSPTestRunner?.stressScenario?.(e),getStatus:()=>r.getStatus(),triggerTestAlerts:()=>r.triggerTestAlerts(),setTestThresholds:()=>r.setTestThresholds(),setNormalThresholds:()=>r.setNormalThresholds(),testAlerts:()=>(console.log(`🧪 Running alert test...`),s.show(),r.startMonitoring(500),r.triggerTestAlerts())},console.log(`🔧 MSP Debug Tools loaded! Use Ctrl+Shift+M to toggle dashboard or MSPDebug.show()`),window.MSPTestRunner={_quickMonitorListener:null,startQuickMonitor(){return console.log(`🚀 Starting MSP Quick Monitor...`),this._quickMonitorListener&&r.removeListener(this._quickMonitorListener),this._quickMonitorListener=e=>{e.alerts&&Object.values(e.alerts).some(e=>e)&&console.warn(`🚨 MSP Alert:`,e.alerts),Date.now()%1e4<500&&console.log(`📊 MSP Status: Queue=${e.currentQueueSize}/${e.maxQueueSize}, Requests=${e.metrics.totalRequests}, AvgTime=${Math.round(e.metrics.avgResponseTime)}ms`)},r.addListener(this._quickMonitorListener),r.startMonitoring(1e3),console.log(`✅ Quick monitor started. Use MSPTestRunner.stopMonitor() to stop.`),{stop:()=>this.stopMonitor(),status:()=>this.getStatus(),analyze:()=>this.analyzeQueue()}},stopMonitor(){r.stopMonitoring(),this._quickMonitorListener&&=(r.removeListener(this._quickMonitorListener),null),console.log(`⏹️ MSP Monitor stopped`)},async runTest(e){console.log(`🧪 Running MSP test: ${e}`);try{let t=await o.runSpecificTest(e);return t.status===`PASSED`?(console.log(`✅ Test ${e} PASSED`),console.table(t.result)):console.error(`❌ Test ${e} FAILED:`,t.error),t}catch(t){return console.error(`💥 Test ${e} crashed:`,t),{status:`ERROR`,error:t.message}}},async runFullSuite(){console.log(`🚀 Running FULL MSP Stress Test Suite...`),console.log(`This may take several minutes and will stress the MSP system.`);let e=Date.now();try{let t=await o.runStressTestSuite(),n=Date.now()-e;return console.log(`\n📊 Test Suite Complete (${Math.round(n/1e3)}s)`),console.log(`✅ Passed: ${t.summary.passed}`),console.log(`❌ Failed: ${t.summary.failed}`),console.log(`📈 Success Rate: ${Math.round(t.summary.successRate*100)}%`),console.log(`🎯 Overall Grade: ${t.summary.overallGrade}`),t.recommendations&&t.recommendations.length>0&&(console.log(`
💡 Recommendations:`),t.recommendations.forEach(e=>console.log(`  • ${e}`))),console.log(`
📋 Detailed Results:`),console.table(t.detailedResults.map(e=>({Test:e.name,Status:e.status,Duration:e.duration?`${Math.round(e.duration)}ms`:`N/A`}))),t}catch(e){return console.error(`💥 Test Suite Failed:`,e),{error:e.message}}},getStatus(){let e=r.getStatus();return console.log(`📊 Current MSP Status:`),console.log(`   Queue: ${e.currentQueueSize}/${e.maxQueueSize}`),console.log(`   Total Requests: ${e.metrics.totalRequests}`),console.log(`   Success Rate: ${Math.round((e.metrics.successRate||0)*100)}%`),console.log(`   Avg Response Time: ${Math.round(e.metrics.avgResponseTime||0)}ms`),console.log(`   Active Alerts: ${Object.values(e.alerts).filter(e=>e).length}`),e.queueContents.length>0&&(console.log(`
📋 Queue Contents:`),console.table(e.queueContents)),e},analyzeQueue(){let e=r.analyzeQueue();return console.log(`🔍 Queue Analysis:`),console.log(`   Total Items: ${e.totalItems}`),console.log(`   Age Distribution:`,e.ageDistribution),console.log(`   By Code:`,e.byCode),e.potentialIssues.length>0&&(console.log(`⚠️ Potential Issues:`),e.potentialIssues.forEach(e=>console.log(`   • ${e}`))),e},generateReport(){let e=r.generateReport();console.log(`📄 Generating MSP Report...`),console.log(`   Queue Health:`,e.summary.queueHealth),console.log(`   Performance Grade:`,e.summary.performanceGrade);let t=new Blob([JSON.stringify(e,null,2)],{type:`application/json`}),n=URL.createObjectURL(t),i=document.createElement(`a`);return i.href=n,i.download=`msp-report-${new Date().toISOString().slice(0,19).replace(/:/g,`-`)}.json`,document.body.appendChild(i),i.click(),document.body.removeChild(i),URL.revokeObjectURL(n),console.log(`✅ Report downloaded`),e},showDashboard(){s.show(),console.log(`🖥️ Debug dashboard opened. Press Ctrl+Shift+M to toggle.`)},async quickHealthCheck(){if(console.log(`🏥 Running Quick MSP Health Check...`),!window.MSP)return console.error(`MSP not available`),{status:`ERROR`,error:`MSP not initialized`};r.startMonitoring(100);let e=[window.MSP.promise(100,null),window.MSP.promise(101,null),window.MSP.promise(108,null)];try{let t=Date.now();await Promise.all(e);let n=Date.now()-t;await new Promise(e=>setTimeout(e,200));let i=r.getStatus();r.stopMonitoring();let a={status:`HEALTHY`,responseTime:n,queueClearedAfterTest:i.currentQueueSize===0,successRate:i.metrics.successRate||0};return n>2e3&&(a.status=`SLOW`,a.warning=`Response times are slow`),a.queueClearedAfterTest||(a.status=`WARNING`,a.warning=`Queue not properly cleared after requests`),a.successRate<1&&(a.status=`FAILING`,a.warning=`Some requests are failing`),console.log(`🏥 Health Check Result: ${a.status}`),console.log(`   Response Time: ${n}ms`),console.log(`   Queue Cleared: ${a.queueClearedAfterTest?`✅`:`❌`}`),console.log(`   Success Rate: ${Math.round(a.successRate*100)}%`),a.warning&&console.warn(`⚠️ ${a.warning}`),a}catch(e){return r.stopMonitoring(),console.error(`💥 Health check failed:`,e),{status:`ERROR`,error:e.message}}},async stressScenario(e){let t={"high-frequency":async()=>{console.log(`🔥 High Frequency Scenario: Sending requests every 10ms for 5 seconds`);let e=[],t=Date.now();for(;Date.now()-t<5e3;)e.push(window.MSP.promise(101,null).catch(e=>(console.error(`MSP request failed in sustained-load scenario:`,e),{error:e.message||`Unknown error`}))),await new Promise(e=>setTimeout(e,10));let n=await Promise.allSettled(e);return{totalRequests:e.length,successful:n.filter(e=>e.status===`fulfilled`).length,duration:Date.now()-t}},"queue-overflow":async()=>{console.log(`💥 Queue Overflow Scenario: Flooding queue beyond capacity`);let e=[];for(let t=0;t<100;t++)e.push(window.MSP.promise(101,null).catch(e=>({error:e.message})));let t=(await Promise.allSettled(e)).filter(e=>e.status===`fulfilled`&&!e.value.error).length;return{requestsSent:100,successful:t,rejected:100-t}},"mixed-load":async()=>{console.log(`🎭 Mixed Load Scenario: Various request types and sizes`);let e=[100,101,102,104,108,110,111,112],t=[];for(let n=0;n<30;n++){let r=e[n%e.length],i=n%4==0?new Uint8Array([n,n+1,n+2]):null;t.push(window.MSP.promise(r,i).catch(e=>(console.error(`MSP request failed in mixed-load scenario (code: ${r}):`,e),{error:e.message||`Unknown error`})))}let n=Date.now(),r=await Promise.allSettled(t),i=Date.now()-n;return{totalRequests:30,successful:r.filter(e=>e.status===`fulfilled`).length,duration:i,avgResponseTime:i/30}}},n=t[e];if(!n){console.error(`❌ Unknown scenario: ${e}`),console.log(`Available scenarios:`,Object.keys(t));return}r.startMonitoring(100);try{let e=await n(),t=r.getStatus();return console.log(`📊 Scenario Results:`),console.table(e),console.log(`📈 Final MSP Status:`),console.table({"Queue Size":t.currentQueueSize,"Total Requests":t.metrics.totalRequests,"Success Rate":`${Math.round((t.metrics.successRate||0)*100)}%`,"Avg Response":`${Math.round(t.metrics.avgResponseTime||0)}ms`}),{scenario:e,mspStatus:t}}catch(e){return console.error(`💥 Scenario failed:`,e),{error:e.message}}finally{r.stopMonitoring()}},help(){console.log(`
🔧 MSP Test Runner Commands:

Basic Monitoring:
  MSPTestRunner.startQuickMonitor()     - Start monitoring with console output
  MSPTestRunner.stopMonitor()           - Stop monitoring
  MSPTestRunner.getStatus()             - Get current status
  MSPTestRunner.analyzeQueue()          - Analyze current queue

Testing:
  MSPTestRunner.runTest('test-name')    - Run specific test
  MSPTestRunner.runFullSuite()          - Run full stress test suite
  MSPTestRunner.quickHealthCheck()      - Quick health check

Stress Scenarios:
  MSPTestRunner.stressScenario('high-frequency')  - High frequency requests
  MSPTestRunner.stressScenario('queue-overflow')  - Queue overflow test
  MSPTestRunner.stressScenario('mixed-load')      - Mixed request types

Visual Tools:
  MSPTestRunner.showDashboard()         - Show visual dashboard
  MSPTestRunner.generateReport()        - Generate and download report

Available Test Names:
  'queue-flooding', 'rapid-fire', 'duplicates', 'timeout-recovery',
  'memory-leaks', 'concurrent-mixed', 'queue-overflow', 
  'connection-disruption', 'performance-load'

Keyboard Shortcuts:
  Ctrl+Shift+M - Toggle debug dashboard
        `)}},console.log(`🔧 MSP Test Runner loaded! Type MSPTestRunner.help() for commands.`),console.log(`
🔧 MSP Debug Tools Loaded Successfully!

Quick Start:
  • Press Ctrl+Shift+M to toggle the visual dashboard
  • Use MSPTestRunner.help() to see all available commands
  • Use MSPTestRunner.quickHealthCheck() for a quick test

Example Usage:
  MSPTestRunner.startQuickMonitor();     // Start monitoring
  MSPTestRunner.runTest('queue-flooding'); // Run specific test  
  MSPTestRunner.showDashboard();         // Show visual dashboard
  MSPTestRunner.runFullSuite();          // Run all stress tests

The tools will help you:
  ✓ Monitor MSP queue health in real-time
  ✓ Detect memory leaks and performance issues
  ✓ Stress test the MSP implementation
  ✓ Analyze queue contents and response times
  ✓ Export detailed diagnostic reports

Happy debugging! 🚀
`),(window.location.hostname===`localhost`||window.location.hostname===`127.0.0.1`)&&(console.log(`🔄 Development environment detected - auto-starting basic monitoring`),e(async()=>{let{mspQueueMonitor:e}=await import(`./msp_queue_monitor-TgpV5sgJ.js`);return{mspQueueMonitor:e}},[],import.meta.url).then(({mspQueueMonitor:e})=>{e.addListener(e=>{Object.values(e.alerts).filter(e=>e).length>0&&console.warn(`🚨 MSP Alert detected - check dashboard for details`)}),e.startMonitoring(2e3)}));export{r as n,t};