const CDP = require('chrome-remote-interface');
const argv = require('minimist')(process.argv.slice(2));
const file = require('mz/fs');
const timeout = require('delay');

// CLI Args
const url = argv.url || 'https://www.google.com';
const format = argv.format === 'jpeg' ? 'jpeg' : 'png';
const viewportWidth = argv.viewportWidth || 1700;
let viewportHeight = argv.viewportHeight || 700;
const delay = argv.delay || 0;
const userAgent = argv.userAgent;
const fullPage = argv.full;
const outputDir = argv.outputDir || './';
const output = argv.output || `output.${format === 'png' ? 'png' : 'jpg'}`;

const finalhandler = require('finalhandler')
const http = require('http')
const serveStatic = require('serve-static')

// Create server
let server = http.createServer(function onRequest (req, res) {
  serveStatic('.', {'index': ['index.html']})(req, res, finalhandler(req, res))
})

init();

async function init() {
  const port = await new Promise((resolve) => server.listen(0, () => resolve(server.address().port)))
  let client;
  try {
    // Start the Chrome Debugging Protocol
    client = await CDP();

    // Verify version
    const { Browser } = await CDP.Version();
    const browserVersion = Browser.match(/\/(\d+)/)[1];
    if (Number(browserVersion) !== 60) {
      console.warn(`This script requires Chrome 60, however you are using version ${browserVersion}. The script is not guaranteed to work and you may need to modify it.`);
    }

    // Extract used DevTools domains.
    const {DOM, Emulation, Network, Page, Runtime, Log} = client;

    // Enable events on domains we are interested in.
    await Page.enable();
    await DOM.enable();
    await Network.enable();
    await Log.enable();

Log.entryAdded((d) => console.log(d))

    // If user agent override was specified, pass to Network domain
    if (userAgent) {
      await Network.setUserAgentOverride({userAgent});
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
    await Emulation.setDefaultBackgroundColorOverride({color: {r: 0, g: 0, b: 0, a: 0}});

    // Navigate to target page
    await Page.navigate({url: `http://localhost:${port}?url=${url}`});

    // Wait for page load event to take screenshot
    await Page.loadEventFired();
    const resourceTree = await Page.getResourceTree();
    await Page.frameNavigated({frame: resourceTree.frameTree.childFrames[0].frame});
    await Page.frameNavigated({frame: resourceTree.frameTree.childFrames[1].frame});
    await Page.frameNavigated({frame: resourceTree.frameTree.childFrames[2].frame});
    await Page.frameStoppedLoading({frameId: resourceTree.frameTree.childFrames[0].frame.id})
    console.log('laptop loaded')
    await Page.frameStoppedLoading({frameId: resourceTree.frameTree.childFrames[1].frame.id})
    console.log('tablet loaded')
    await Page.frameStoppedLoading({frameId: resourceTree.frameTree.childFrames[2].frame.id})
    console.log('mobile loaded')
    await new Promise((resolve) => setTimeout(() => resolve(), 500))

    await timeout(delay);
    // If the `full` CLI option was passed, we need to measure the height of
    // the rendered page and use Emulation.setVisibleSize
    if (fullPage) {
      const {root: {nodeId: documentNodeId}} = await DOM.getDocument();
      const {nodeId: bodyNodeId} = await DOM.querySelector({
        selector: 'body',
        nodeId: documentNodeId,
      });
      const {model} = await DOM.getBoxModel({nodeId: bodyNodeId});
      viewportHeight = model.height;

      await Emulation.setVisibleSize({width: viewportWidth, height: viewportHeight});
      // This forceViewport call ensures that content outside the viewport is
      // rendered, otherwise it shows up as grey. Possibly a bug?
      // await Emulation.forceViewport({x: 0, y: 0, scale: 1});
    }

    const screenshot = await Page.captureScreenshot({
      format,
      fromSurface: true,
      clip: {
        width: viewportWidth,
        height: viewportHeight
      }
    });

    const buffer = new Buffer(screenshot.data, 'base64');
    const path = `${outputDir + output}`;
    await file.writeFile(path, buffer, 'base64');
    console.log('Screenshot saved');
    client.close();
    server.close();
  } catch (err) {
    if (client) {
      client.close();
      server.close();
    }
    console.error('Exception while taking screenshot:', err);
    process.exit(1);
  }
}
