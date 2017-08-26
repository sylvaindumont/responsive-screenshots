const CDP = require('chrome-remote-interface');
const argv = require('minimist')(process.argv.slice(2));
const file = require('mz/fs');
const mkdirp = require('mkdirp');
const spawn = require('child_process').spawn;
const finalhandler = require('finalhandler');
const http = require('http');
const serveStatic = require('serve-static');

// CLI Args
const url = argv.url || 'https://www.google.com';
const format = argv.format === 'jpeg' ? 'jpeg' : 'png';
const viewportWidth = argv.viewportWidth || 1700;
let viewportHeight = argv.viewportHeight || 700;
const delay = argv.delay || 0;
const userAgent = argv.userAgent;
const outputDir = argv.dir || './screenshots/';
const output = `${argv.out || 'output'}.${format === 'jpg' ? 'jpg' : 'png'}`;

mkdirp(outputDir);
const chrome = spawn(argv.chromium ? 'chromium' : 'google-chrome', [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=9222',
]);

// Create server
let server = http.createServer(function onRequest(req, res) {
  serveStatic('.', { index: ['index.html'] })(req, res, finalhandler(req, res));
});
let client;

init();

function exit() {
  if (client) {
    client.close();
  }
  server.close();
  chrome.kill();
}

async function init() {
  await new Promise(resolve => {
    chrome.stdout.on('data', function(data) {
      resolve();
    });
    chrome.stderr.on('data', function(data) {
      resolve();
    });
  });
  console.log('chrome started');
  const port = await new Promise(resolve =>
    server.listen(0, () => resolve(server.address().port)),
  );
  try {
    // Start the Chrome Debugging Protocol
    client = await CDP();

    // Verify version
    const { Browser } = await CDP.Version();
    const browserVersion = Browser.match(/\/(\d+)/)[1];
    if (Number(browserVersion) !== 60) {
      console.warn(
        `This script requires Chrome 60, however you are using version ${browserVersion}. The script is not guaranteed to work and you may need to modify it.`,
      );
    }

    // Extract used DevTools domains.
    const { DOM, Emulation, Network, Page, Runtime, Log } = client;

    // Enable events on domains we are interested in.
    await Page.enable();
    await DOM.enable();
    await Network.enable();
    await Log.enable();

    // Log messages from browser console
    Log.entryAdded(d => console.log(d));

    // If user agent override was specified, pass to Network domain
    if (userAgent) {
      await Network.setUserAgentOverride({ userAgent });
    }

    // Set up viewport resolution, etc.
    const deviceMetrics = {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 0,
      mobile: false,
      fitWindow: false,
    };
    await Emulation.setDeviceMetricsOverride(deviceMetrics);
    await Emulation.setVisibleSize({
      width: viewportWidth,
      height: viewportHeight,
    });
    await Emulation.setDefaultBackgroundColorOverride({
      color: { r: 0, g: 0, b: 0, a: 0 },
    });

    // Navigate to target page
    await Page.navigate({ url: `http://localhost:${port}?url=${url}` });

    // Wait for page load event to take screenshot
    await Page.loadEventFired();
    const resourceTree = await Page.getResourceTree();
    await Page.frameNavigated({
      frame: resourceTree.frameTree.childFrames[0].frame,
    });
    await Page.frameNavigated({
      frame: resourceTree.frameTree.childFrames[1].frame,
    });
    await Page.frameNavigated({
      frame: resourceTree.frameTree.childFrames[2].frame,
    });
    await Page.frameStoppedLoading({
      frameId: resourceTree.frameTree.childFrames[0].frame.id,
    });
    console.log('laptop loaded');
    await Page.frameStoppedLoading({
      frameId: resourceTree.frameTree.childFrames[1].frame.id,
    });
    console.log('tablet loaded');
    await Page.frameStoppedLoading({
      frameId: resourceTree.frameTree.childFrames[2].frame.id,
    });
    console.log('mobile loaded');
    await new Promise(resolve => setTimeout(() => resolve(), delay));
    console.log('delay waited');

    const screenshot = await Page.captureScreenshot({
      format,
      fromSurface: true,
      clip: {
        width: viewportWidth,
        height: viewportHeight,
      },
    });

    const buffer = new Buffer(screenshot.data, 'base64');
    const path = `${outputDir + output}`;
    await file.writeFile(path, buffer, 'base64');
    console.log('Screenshot saved');
    exit();
  } catch (err) {
    exit();
    console.error('Exception while taking screenshot:', err);
    process.exit(1);
  }
}

process.on('exit', () => exit());
