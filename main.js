"use strict";
const { Plugin, Notice, PluginSettingTab, Setting } = require("obsidian");
const DEFAULTS = { margin: 80 };

module.exports = class CanvasLiveSnapshot extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    delete this.settings.outputFolder;
    this.settings.margin = Number.isFinite(Number(this.settings.margin)) ? Math.max(0, Math.min(1000, Number(this.settings.margin))) : 80;
    this.busy = false;
    this.addCommand({
      id: "export-html-snapshot", name: "导出当前 Canvas HTML 快照（用于打印 PDF）",
      checkCallback: (checking) => {
        const view = this.app.workspace.activeLeaf?.view;
        const available = view?.getViewType() === "canvas";
        if (available && !checking) void this.exportSnapshot(view);
        return available;
      }
    });
    this.addRibbonIcon("image-down", "导出 Canvas HTML 快照", () => {
      void this.exportSnapshot(this.app.workspace.activeLeaf?.view);
    });
    this.addSettingTab(new SnapshotSettings(this.app, this));
  }

  async exportSnapshot(view) {
    if (this.busy) { new Notice("正在导出，请稍候。"); return; }
    const wrapper = view?.getViewType() === "canvas" && view.containerEl.querySelector(".canvas-wrapper");
    if (!wrapper) { new Notice("请先打开并选中要导出的 Canvas。"); return; }
    this.busy = true;
    const progress = new Notice("正在制作 Canvas 快照，请勿切换或缩放画布……", 0);
    const basename = view.file?.basename || "Canvas";
    try {
      const result = await createSnapshot(this, wrapper);
      if (!result) return;
      const fs = require("fs").promises;
      const nodePath = require("path");
      const folder = getDownloadsFolder();
      await fs.mkdir(folder, { recursive: true });
      const safeName = basename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const stem = nodePath.join(folder, safeName + "-" + stamp);
      let path = stem + ".html", suffix = 1;
      while (true) {
        try {
          await fs.writeFile(path, result.html, { encoding: "utf8", flag: "wx" });
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          path = stem + "-" + suffix++ + ".html";
        }
      }
      try {
        const errorMessage = await require("electron").shell.openPath(path);
        if (errorMessage) throw new Error(errorMessage);
        new Notice("快照已保存并已请求自动打开：" + path + "\n在打开的页面点击 Print / Save PDF。", 12000);
      } catch (error) {
        console.error("Canvas Live Snapshot could not open saved HTML", error);
        new Notice("快照已保存，但自动打开失败：" + path + "\n" + (error.message || String(error)) + "\n请手动用浏览器打开该文件。", 15000);
      }
    } catch (error) {
      console.error("Canvas Live Snapshot export failed", error);
      new Notice("导出失败：" + (error.message || String(error)), 10000);
    } finally {
      progress.hide();
      this.busy = false;
    }
  }
};

function getDownloadsFolder() {
  // Prefer the OS-configured Downloads directory, including relocated folders.
  try {
    const electron = require("electron");
    const app = electron.app || electron.remote?.app;
    if (app) return app.getPath("downloads");
  } catch (_) {}
  try {
    return require("@electron/remote").app.getPath("downloads");
  } catch (_) {}
  return require("path").join(require("os").homedir(), "Downloads");
}

class SnapshotSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("输出目录").setDesc("自动保存到系统下载文件夹：" + getDownloadsFolder());
    new Setting(this.containerEl).setName("画布边距").setDesc("快照四周的空白，单位 px。").addSlider(slider => slider
      .setLimits(0, 300, 10).setValue(this.plugin.settings.margin).setDynamicTooltip().onChange(async value => {
        this.plugin.settings.margin = value; await this.plugin.saveData(this.plugin.settings);
      }));
    this.containerEl.createEl("p", { text: "导出前请结束节点编辑，缩放到能看到全部节点，并等待图片和网页加载完成。导出保留当前缩放比例；网页截图失败时会保留 iframe。" });
  }
}

async function createSnapshot(plugin, wrapper) {
  const document = wrapper.ownerDocument;
  const getComputedStyle = document.defaultView.getComputedStyle.bind(document.defaultView);
  const edgeSvg =
    wrapper.querySelector(
      'svg.canvas-edges'
    );
  if (!edgeSvg) {
    new Notice(
      '没有找到 Canvas 连线 SVG。'
    );
    return;
  }
  // ============================================================
  // 参数
  // ============================================================
  const MARGIN = plugin.settings.margin;
  const SVG_NS =
    'http://www.w3.org/2000/svg';
  // ============================================================
  // 工具：sleep
  // ============================================================
  function sleep(ms) {
    return new Promise(
      resolve => setTimeout(
        resolve,
        ms
      )
    );
  }
  // ============================================================
  // 1. 判断 Group
  // ============================================================
  function isGroupNode(el) {
    if (!el) {
      return false;
    }
    return (
      el.classList.contains(
        'is-group'
      ) ||
      el.classList.contains(
        'canvas-group'
      ) ||
      el.classList.contains(
        'canvas-node-group'
      ) ||
      el.getAttribute(
        'data-node-type'
      ) === 'group' ||
      el.getAttribute(
        'data-type'
      ) === 'group' ||
      el.dataset?.nodeType ===
        'group' ||
      el.dataset?.type ===
        'group'
    );
  }
  // ============================================================
  // 2. 找出 Canvas 节点 / Group
  // ============================================================
  const items = [
    ...new Set([
      ...wrapper.querySelectorAll(
        '.canvas-node'
      ),
      ...wrapper.querySelectorAll(
        '.canvas-group'
      ),
      ...wrapper.querySelectorAll(
        '.canvas-node-group'
      ),
      ...wrapper.querySelectorAll(
        '.canvas-node.is-group'
      ),
      ...wrapper.querySelectorAll(
        '[data-node-type="group"]'
      )
    ])
  ].filter(el => {
    const r =
      el.getBoundingClientRect();
    const cs =
      getComputedStyle(el);
    return (
      r.width > 1 &&
      r.height > 1 &&
      cs.display !==
        'none' &&
      cs.visibility !==
        'hidden'
    );
  });
  if (!items.length) {
    new Notice(
      '没有找到 Canvas 节点。'
    );
    return;
  }
  // ============================================================
  // 3. Canvas 完整边界
  // ============================================================
  const rects =
    items.map(
      el =>
        el.getBoundingClientRect()
    );
  let minX =
    Math.min(
      ...rects.map(
        r => r.left
      )
    ) - MARGIN;
  let minY =
    Math.min(
      ...rects.map(
        r => r.top
      )
    ) - MARGIN;
  let maxX =
    Math.max(
      ...rects.map(
        r => r.right
      )
    ) + MARGIN;
  let maxY =
    Math.max(
      ...rects.map(
        r => r.bottom
      )
    ) + MARGIN;
  const width =
    Math.ceil(
      maxX - minX
    );
  const height =
    Math.ceil(
      maxY - minY
    );
  console.log(
    `Canvas 输出尺寸：${width} × ${height}`
  );
  // ============================================================
  // 4. URL → Base64
  // ============================================================
  const dataCache =
    new Map();
  async function urlToDataURL(url) {
    if (!url) {
      return url;
    }
    if (
      url.startsWith(
        'data:'
      ) ||
      url.startsWith(
        '#'
      )
    ) {
      return url;
    }
    if (
      dataCache.has(url)
    ) {
      return dataCache.get(
        url
      );
    }
    try {
      const res =
        await fetch(url);
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status}`
        );
      }
      const blob =
        await res.blob();
      const result =
        await new Promise(
          (resolve, reject) => {
            const reader =
              new FileReader();
            reader.onload =
              () =>
                resolve(
                  reader.result
                );
            reader.onerror =
              reject;
            reader.readAsDataURL(
              blob
            );
          }
        );
      dataCache.set(
        url,
        result
      );
      return result;
    }
    catch (err) {
      console.warn(
        '资源无法内嵌：',
        url,
        err
      );
      return url;
    }
  }
  // ============================================================
  // 5. 复制 computed CSS
  // ============================================================
  function copyComputedStyles(
    source,
    clone
  ) {
    if (
      !(source instanceof document.defaultView.Element) ||
      !(clone instanceof document.defaultView.Element)
    ) {
      return;
    }
    const cs =
      getComputedStyle(
        source
      );
    for (
      const prop of cs
    ) {
      try {
        const value =
          cs.getPropertyValue(
            prop
          );
        if (value) {
          clone.style.setProperty(
            prop,
            value,
            cs.getPropertyPriority(
              prop
            )
          );
        }
      }
      catch (_) {}
    }
    const srcChildren =
      [...source.children];
    const cloneChildren =
      [...clone.children];
    const len =
      Math.min(
        srcChildren.length,
        cloneChildren.length
      );
    for (
      let i = 0;
      i < len;
      i++
    ) {
      copyComputedStyles(
        srcChildren[i],
        cloneChildren[i]
      );
    }
  }
  // ============================================================
  // 6. 内嵌普通图片 / CSS 背景 / Canvas
  // ============================================================
  async function inlineMedia(
    sourceRoot,
    cloneRoot
  ) {
    // ----------------------------------------------------------
    // IMG
    // ----------------------------------------------------------
    const sourceImgs = [
      ...(
        sourceRoot.matches?.(
          'img'
        )
          ? [sourceRoot]
          : []
      ),
      ...sourceRoot.querySelectorAll(
        'img'
      )
    ];
    const cloneImgs = [
      ...(
        cloneRoot.matches?.(
          'img'
        )
          ? [cloneRoot]
          : []
      ),
      ...cloneRoot.querySelectorAll(
        'img'
      )
    ];
    for (
      let i = 0;
      i <
      Math.min(
        sourceImgs.length,
        cloneImgs.length
      );
      i++
    ) {
      const src =
        sourceImgs[i].currentSrc ||
        sourceImgs[i].src ||
        sourceImgs[i].getAttribute(
          'src'
        );
      if (!src) {
        continue;
      }
      const dataURL =
        await urlToDataURL(
          src
        );
      cloneImgs[i].src =
        dataURL;
      cloneImgs[i]
        .removeAttribute(
          'srcset'
        );
      cloneImgs[i]
        .removeAttribute(
          'loading'
        );
    }
    // ----------------------------------------------------------
    // background-image
    // ----------------------------------------------------------
    const srcEls = [
      sourceRoot,
      ...sourceRoot.querySelectorAll(
        '*'
      )
    ];
    const dstEls = [
      cloneRoot,
      ...cloneRoot.querySelectorAll(
        '*'
      )
    ];
    for (
      let i = 0;
      i <
      Math.min(
        srcEls.length,
        dstEls.length
      );
      i++
    ) {
      const bg =
        getComputedStyle(
          srcEls[i]
        ).backgroundImage;
      if (
        !bg ||
        bg === 'none' ||
        !bg.includes(
          'url('
        )
      ) {
        continue;
      }
      let replaced =
        bg;
      const matches = [
        ...bg.matchAll(
          /url\(["']?(.*?)["']?\)/g
        )
      ];
      for (
        const match of matches
      ) {
        const originalURL =
          match[1];
        const dataURL =
          await urlToDataURL(
            originalURL
          );
        replaced =
          replaced.replace(
            match[0],
            `url("${dataURL}")`
          );
      }
      dstEls[i]
        .style
        .backgroundImage =
          replaced;
    }
    // ----------------------------------------------------------
    // HTML Canvas → PNG
    // ----------------------------------------------------------
    const sourceCanvas =
      sourceRoot.querySelectorAll(
        'canvas'
      );
    const cloneCanvas =
      cloneRoot.querySelectorAll(
        'canvas'
      );
    for (
      let i = 0;
      i <
      Math.min(
        sourceCanvas.length,
        cloneCanvas.length
      );
      i++
    ) {
      try {
        const data =
          sourceCanvas[i]
            .toDataURL(
              'image/png'
            );
        const img =
          document.createElement(
            'img'
          );
        img.src =
          data;
        img.style.cssText =
          cloneCanvas[i]
            .style
            .cssText;
        img.style.width =
          `${sourceCanvas[i].offsetWidth}px`;
        img.style.height =
          `${sourceCanvas[i].offsetHeight}px`;
        cloneCanvas[i]
          .replaceWith(
            img
          );
      }
      catch (err) {
        console.warn(
          'Canvas 元素冻结失败：',
          err
        );
      }
    }
  }
  // ============================================================
  // 7. 删除 Obsidian 编辑 UI
  // ============================================================
  function removeUI(
    clone
  ) {
    clone.classList.remove(
      'is-selected',
      'is-focused',
      'is-editing',
      'is-dragging'
    );
    clone.querySelectorAll(`
      .canvas-node-resizer,
      .canvas-node-connection-point,
      .canvas-node-connection-point-container,
      .canvas-control-item,
      .canvas-menu,
      .canvas-card-menu,
      .canvas-selection,
      .canvas-node-menu
    `).forEach(
      el => el.remove()
    );
    clone
      .querySelectorAll('*')
      .forEach(el => {
        el.classList.remove(
          'is-selected',
          'is-focused',
          'is-editing',
          'is-dragging'
        );
      });
  }
  // ============================================================
  // 8. 判断是否透明色
  // ============================================================
  function isTransparentColor(
    color
  ) {
    if (!color) {
      return true;
    }
    const c =
      color
        .replace(/\s/g, '')
        .toLowerCase();
    return (
      c ===
        'transparent' ||
      c ===
        'rgba(0,0,0,0)' ||
      c ===
        'hsla(0,0%,0%,0)'
    );
  }
  // ============================================================
  // 9. 找一个合适的背景颜色
  // ============================================================
  function findBackgroundColor(
    element,
    fallback = '#ffffff'
  ) {
    let current =
      element;
    while (
      current &&
      current !== wrapper
    ) {
      try {
        const bg =
          getComputedStyle(
            current
          ).backgroundColor;
        if (
          !isTransparentColor(
            bg
          )
        ) {
          return bg;
        }
      }
      catch (_) {}
      current =
        current.parentElement;
    }
    return fallback;
  }
  // ============================================================
  // 10. 等待 WebView 渲染稳定
  // ============================================================
  async function waitForWebview(
    webview
  ) {
    try {
      if (
        typeof webview.isLoading ===
          'function' &&
        webview.isLoading()
      ) {
        await Promise.race([
          new Promise(
            resolve => {
              webview.addEventListener(
                'did-stop-loading',
                resolve,
                {
                  once: true
                }
              );
            }
          ),
          sleep(
            5000
          )
        ]);
      }
    }
    catch (_) {}
    // 给字体 / CSS / 图片 / WebGL 一点稳定时间
    await sleep(
      300
    );
  }
  // ============================================================
  // 11. 把网页节点冻结成真正的静态图片
  //
  // WebView:
  // current rendered page
  //        ↓
  // capturePage()
  //        ↓
  // NativeImage
  //        ↓
  // PNG DataURL
  //
  // 这样打印 PDF 时不会重新加载网页。
  // ============================================================
  async function freezeEmbeddedPages(
    sourceRoot,
    cloneRoot
  ) {
    const sourceWebviews =
      [
        ...sourceRoot.querySelectorAll(
          'webview'
        )
      ];
    const cloneWebviews =
      [
        ...cloneRoot.querySelectorAll(
          'webview'
        )
      ];
    // ----------------------------------------------------------
    // Electron WebView
    // ----------------------------------------------------------
    for (
      let i = 0;
      i <
      Math.min(
        sourceWebviews.length,
        cloneWebviews.length
      );
      i++
    ) {
      const sourceWebview =
        sourceWebviews[i];
      const cloneWebview =
        cloneWebviews[i];
      try {
        await waitForWebview(
          sourceWebview
        );
        if (
          typeof
          sourceWebview.capturePage !==
          'function'
        ) {
          throw new Error(
            '该 WebView 没有 capturePage()'
          );
        }
        // ------------------------------------------------------
        // 截取当前实际网页画面
        // ------------------------------------------------------
        const nativeImage =
          await sourceWebview
            .capturePage();
        if (!nativeImage) {
          throw new Error(
            'capturePage() 没有返回图像'
          );
        }
        if (
          typeof nativeImage.isEmpty ===
            'function' &&
          nativeImage.isEmpty()
        ) {
          throw new Error(
            'capturePage() 返回空图像'
          );
        }
        const dataURL =
          nativeImage
            .toDataURL();
        if (!dataURL) {
          throw new Error(
            '无法生成网页 PNG'
          );
        }
        const r =
          sourceWebview
            .getBoundingClientRect();
        // ------------------------------------------------------
        // 获取当前网页节点的背景
        // ------------------------------------------------------
        const pageBackground =
          findBackgroundColor(
            sourceWebview,
            '#ffffff'
          );
        // ------------------------------------------------------
        // 用 wrapper + img
        //
        // wrapper 的背景确保透明 PNG 也不会丢底色
        // ------------------------------------------------------
        const snapshot =
          document.createElement(
            'div'
          );
        snapshot.style.cssText =
          cloneWebview.style.cssText;
        snapshot.style.display =
          'block';
        snapshot.style.position =
          'relative';
        snapshot.style.width =
          '100%';
        snapshot.style.height =
          '100%';
        snapshot.style.margin =
          '0';
        snapshot.style.padding =
          '0';
        snapshot.style.overflow =
          'hidden';
        snapshot.style.boxSizing =
          'border-box';
        snapshot.style.backgroundColor =
          pageBackground;
        const originalStyle =
          getComputedStyle(
            sourceWebview
          );
        snapshot.style.border =
          originalStyle.border;
        snapshot.style.borderRadius =
          originalStyle.borderRadius;
        const img =
          document.createElement(
            'img'
          );
        img.src =
          dataURL;
        img.alt =
          'Embedded page snapshot';
        img.style.display =
          'block';
        img.style.position =
          'absolute';
        img.style.left =
          '0';
        img.style.top =
          '0';
        img.style.width =
          '100%';
        img.style.height =
          '100%';
        img.style.maxWidth =
          'none';
        img.style.maxHeight =
          'none';
        img.style.objectFit =
          'fill';
        img.style.margin =
          '0';
        img.style.padding =
          '0';
        img.style.border =
          '0';
        img.style.backgroundColor =
          pageBackground;
        snapshot.appendChild(
          img
        );
        cloneWebview
          .replaceWith(
            snapshot
          );
        console.log(
          `网页静态截图成功：${Math.round(r.width)} × ${Math.round(r.height)}`
        );
      }
      catch (err) {
        console.warn(
          'WebView 截图失败，使用 iframe fallback：',
          err
        );
        const iframe =
          document.createElement(
            'iframe'
          );
        const src =
          sourceWebview.getAttribute(
            'src'
          ) ||
          sourceWebview.src;
        if (src) {
          iframe.src =
            src;
        }
        iframe.style.cssText =
          cloneWebview.style.cssText;
        iframe.style.display =
          'block';
        iframe.style.width =
          '100%';
        iframe.style.height =
          '100%';
        iframe.style.border =
          '0';
        iframe.style.backgroundColor =
          findBackgroundColor(
            sourceWebview,
            '#ffffff'
          );
        iframe.style.pointerEvents =
          'none';
        iframe.setAttribute(
          'loading',
          'eager'
        );
        cloneWebview
          .replaceWith(
            iframe
          );
      }
    }
    // ----------------------------------------------------------
    // 如果源节点本身使用 iframe
    //
    // 普通跨域 iframe 无法从 JS 读取像素，
    // 因此暂时保留。
    // ----------------------------------------------------------
    const sourceIframes =
      [
        ...sourceRoot.querySelectorAll(
          'iframe'
        )
      ];
    const cloneIframes =
      [
        ...cloneRoot.querySelectorAll(
          'iframe'
        )
      ];
    for (
      let i = 0;
      i <
      Math.min(
        sourceIframes.length,
        cloneIframes.length
      );
      i++
    ) {
      const srcIframe =
        sourceIframes[i];
      const dstIframe =
        cloneIframes[i];
      dstIframe.setAttribute(
        'loading',
        'eager'
      );
      dstIframe.style.pointerEvents =
        'none';
      dstIframe.style.backgroundColor =
        findBackgroundColor(
          srcIframe,
          '#ffffff'
        );
    }
  }
  // ============================================================
  // 12. 创建 HTML Stage
  // ============================================================
  const stage =
    document.createElement(
      'main'
    );
  stage.id =
    'canvas-export';
  stage.style.cssText = `
    position:relative;
    width:${width}px;
    height:${height}px;
    overflow:hidden;
    margin:0;
    padding:0;
    isolation:isolate;
  `;
  // ============================================================
  // 13. Canvas 背景
  // ============================================================
  const wrapperStyle =
    getComputedStyle(
      wrapper
    );
  stage.style.backgroundColor =
    isTransparentColor(
      wrapperStyle.backgroundColor
    )
      ? '#1e1e1e'
      : wrapperStyle.backgroundColor;
  stage.style.backgroundImage =
    wrapperStyle.backgroundImage;
  stage.style.backgroundSize =
    wrapperStyle.backgroundSize;
  stage.style.backgroundPosition =
    wrapperStyle.backgroundPosition;
  stage.style.backgroundRepeat =
    wrapperStyle.backgroundRepeat;
  // ============================================================
  // 14. 复制 Advanced Canvas 当前实际连线
  // ============================================================
  const outputSvg =
    document.createElementNS(
      SVG_NS,
      'svg'
    );
  outputSvg.setAttribute(
    'width',
    width
  );
  outputSvg.setAttribute(
    'height',
    height
  );
  outputSvg.setAttribute(
    'viewBox',
    `0 0 ${width} ${height}`
  );
  outputSvg.style.cssText = `
    position:absolute;
    left:0;
    top:0;
    width:${width}px;
    height:${height}px;
    overflow:visible;
    pointer-events:none;
    z-index:10;
  `;
  const edgeClone =
    edgeSvg.cloneNode(
      true
    );
  copyComputedStyles(
    edgeSvg,
    edgeClone
  );
  // ------------------------------------------------------------
  // Marker / defs
  // ------------------------------------------------------------
  const defs =
    edgeClone.querySelector(
      'defs'
    );
  if (defs) {
    outputSvg.appendChild(
      defs.cloneNode(
        true
      )
    );
  }
  const edgeGroup =
    document.createElementNS(
      SVG_NS,
      'g'
    );
  const matrix =
    edgeSvg.getScreenCTM();
  if (matrix) {
    edgeGroup.setAttribute(
      'transform',
      `matrix(
        ${matrix.a}
        ${matrix.b}
        ${matrix.c}
        ${matrix.d}
        ${matrix.e - minX}
        ${matrix.f - minY}
      )`
    );
  }
  [...edgeClone.children]
    .forEach(child => {
      if (
        child.tagName
          .toLowerCase() !==
        'defs'
      ) {
        edgeGroup.appendChild(
          child.cloneNode(
            true
          )
        );
      }
    });
  // ------------------------------------------------------------
  // 修正 marker URL
  // ------------------------------------------------------------
  edgeGroup
    .querySelectorAll('*')
    .forEach(el => {
      [
        'marker-start',
        'marker-mid',
        'marker-end'
      ].forEach(attr => {
        const value =
          el.getAttribute(
            attr
          );
        if (!value) {
          return;
        }
        const match =
          value.match(
            /#([^)"']+)/
          );
        if (match) {
          el.setAttribute(
            attr,
            `url(#${match[1]})`
          );
        }
      });
      const style =
        el.getAttribute(
          'style'
        );
      if (style) {
        el.setAttribute(
          'style',
          style.replace(
            /url\(["']?[^#)"']*#([^)"']+)["']?\)/g,
            'url(#$1)'
          )
        );
      }
    });
  outputSvg.appendChild(
    edgeGroup
  );
  stage.appendChild(
    outputSvg
  );
  // ============================================================
  // 15. 节点排序
  // ============================================================
  const sortedItems =
    [...items].sort(
      (a, b) => {
        const ga =
          isGroupNode(a);
        const gb =
          isGroupNode(b);
        if (
          ga &&
          !gb
        ) {
          return -1;
        }
        if (
          !ga &&
          gb
        ) {
          return 1;
        }
        const za =
          parseInt(
            getComputedStyle(a)
              .zIndex
          ) || 0;
        const zb =
          parseInt(
            getComputedStyle(b)
              .zIndex
          ) || 0;
        return za - zb;
      }
    );
  // ============================================================
  // 16. 克隆所有节点
  // ============================================================
  for (
    const original of sortedItems
  ) {
    const r =
      original
        .getBoundingClientRect();
    const ow =
      original.offsetWidth ||
      r.width;
    const oh =
      original.offsetHeight ||
      r.height;
    const scaleX =
      r.width / ow;
    const scaleY =
      r.height / oh;
    const group =
      isGroupNode(
        original
      );
    // ----------------------------------------------------------
    // Host
    // ----------------------------------------------------------
    const host =
      document.createElement(
        'div'
      );
    const originalZ =
      parseInt(
        getComputedStyle(
          original
        ).zIndex
      );
    const finalZ =
      group
        ? 2
        : Math.max(
            20,
            Number.isFinite(
              originalZ
            )
              ? originalZ
              : 20
          );
    host.style.cssText = `
      position:absolute;
      left:${r.left - minX}px;
      top:${r.top - minY}px;
      width:${r.width}px;
      height:${r.height}px;
      overflow:visible;
      margin:0;
      padding:0;
      z-index:${finalZ};
      pointer-events:none;
    `;
    // ----------------------------------------------------------
    // Clone
    // ----------------------------------------------------------
    const clone =
      original.cloneNode(
        true
      );
    copyComputedStyles(
      original,
      clone
    );
    // 普通图片先冻结
    await inlineMedia(
      original,
      clone
    );
    // 网页再冻结
    await freezeEmbeddedPages(
      original,
      clone
    );
    // ----------------------------------------------------------
    removeUI(clone);
    // 去掉 Canvas 世界坐标
    // ----------------------------------------------------------
    clone.style.position =
      'absolute';
    clone.style.left =
      '0';
    clone.style.top =
      '0';
    clone.style.width =
      `${ow}px`;
    clone.style.height =
      `${oh}px`;
    clone.style.margin =
      '0';
    clone.style.zIndex =
      '0';
    clone.style.visibility =
      'visible';
    clone.style.opacity =
      getComputedStyle(
        original
      ).opacity || '1';
    clone.style.transform =
      `scale(${scaleX}, ${scaleY})`;
    clone.style.transformOrigin =
      '0 0';
    // ----------------------------------------------------------
    // Group
    // ----------------------------------------------------------
    if (group) {
      clone.style.pointerEvents =
        'none';
      clone.style.visibility =
        'visible';
      clone
        .querySelectorAll('*')
        .forEach(el => {
          const z =
            parseInt(
              getComputedStyle(
                el
              ).zIndex
            );
          if (
            Number.isFinite(z) &&
            z < 0
          ) {
            el.style.zIndex =
              '0';
          }
        });
    }
    host.appendChild(
      clone
    );
    stage.appendChild(
      host
    );
  }
  // ============================================================
  // 17. Group Frame 再保险
  //
  // 防止 Group 边框其实来自 ::before / ::after
  // ============================================================
  const groups =
    sortedItems.filter(
      isGroupNode
    );
  for (
    const original of groups
  ) {
    const r =
      original
        .getBoundingClientRect();
    const cs =
      getComputedStyle(
        original
      );
    const frame =
      document.createElement(
        'div'
      );
    frame.style.position =
      'absolute';
    frame.style.left =
      `${r.left - minX}px`;
    frame.style.top =
      `${r.top - minY}px`;
    frame.style.width =
      `${r.width}px`;
    frame.style.height =
      `${r.height}px`;
    frame.style.boxSizing =
      'border-box';
    frame.style.pointerEvents =
      'none';
    frame.style.zIndex =
      '3';
    frame.style.borderRadius =
      cs.borderRadius ||
      '8px';
    // ----------------------------------------------------------
    // 找真实边框
    // ----------------------------------------------------------
    let borderWidth =
      parseFloat(
        cs.borderTopWidth
      );
    let borderStyle =
      cs.borderTopStyle;
    let borderColor =
      cs.borderTopColor;
    if (
      !borderWidth ||
      borderStyle ===
        'none'
    ) {
      const descendants = [
        ...original.querySelectorAll(
          '*'
        )
      ];
      for (
        const child of descendants
      ) {
        const childCS =
          getComputedStyle(
            child
          );
        const bw =
          parseFloat(
            childCS.borderTopWidth
          );
        if (
          bw > 0 &&
          childCS.borderTopStyle !==
            'none'
        ) {
          borderWidth =
            bw;
          borderStyle =
            childCS.borderTopStyle;
          borderColor =
            childCS.borderTopColor;
          break;
        }
      }
    }
    // ----------------------------------------------------------
    // fallback
    // ----------------------------------------------------------
    if (
      !borderWidth ||
      borderStyle ===
        'none'
    ) {
      borderWidth =
        1;
      borderStyle =
        'solid';
      borderColor =
        cs.getPropertyValue(
          '--canvas-color'
        ) ||
        cs.getPropertyValue(
          '--canvas-color-1'
        ) ||
        cs.getPropertyValue(
          '--interactive-accent'
        ) ||
        '#7e7e7e';
    }
    frame.style.border =
      `${borderWidth}px ${borderStyle} ${borderColor}`;
    // ----------------------------------------------------------
    // Group 背景
    // ----------------------------------------------------------
    const bg =
      cs.backgroundColor;
    if (
      !isTransparentColor(
        bg
      )
    ) {
      frame.style.backgroundColor =
        bg;
    }
    stage.appendChild(
      frame
    );
  }
  // ============================================================
  // 18. HTML
  // ============================================================
  const bgColor =
    stage.style
      .backgroundColor ||
    '#1e1e1e';
  const html = `
<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width, initial-scale=1"
>
<title>
Advanced Canvas PDF Snapshot
</title>
<style>
@page {
  size:
    ${width}px
    ${height}px;
  margin:
    0;
}
* {
  box-sizing:
    border-box;
}
html,
body {
  margin:
    0;
  padding:
    0;
  width:
    ${width}px;
  height:
    ${height}px;
  overflow:
    hidden;
  background:
    ${bgColor};
  -webkit-print-color-adjust:
    exact !important;
  print-color-adjust:
    exact !important;
}
#canvas-export {
  position:
    relative;
  page-break-inside:
    avoid;
  break-inside:
    avoid;
}
#print-panel {
  position:
    fixed;
  top:
    16px;
  right:
    16px;
  z-index:
    999999999;
  display:
    flex;
  gap:
    8px;
  align-items:
    center;
  padding:
    8px;
  border-radius:
    10px;
  background:
    rgba(255,255,255,.94);
  box-shadow:
    0 3px 16px rgba(0,0,0,.3);
  font:
    13px
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  color:
    #111;
}
#print-button {
  appearance:
    none;
  border:
    0;
  border-radius:
    7px;
  padding:
    9px 14px;
  background:
    #111;
  color:
    white;
  cursor:
    pointer;
  font:
    inherit;
}
#print-info {
  padding:
    0 6px;
  opacity:
    .65;
}
iframe {
  border:
    0;
}
@media print {
  #print-panel {
    display:
      none !important;
  }
  html,
  body {
    overflow:
      visible !important;
  }
}
</style>
</head>
<body>
${stage.outerHTML}
<div
  id="print-panel"
>
  <span
    id="print-info"
  >
    ${width} × ${height}px
  </span>
  <button
    id="print-button"
    onclick="window.print()"
  >
    Print / Save PDF
  </button>
</div>
<script>
window.addEventListener(
  'load',
  () => {
    document
      .querySelectorAll('iframe')
      .forEach(frame => {
        frame.addEventListener(
          'load',
          () => {
            console.log(
              'Fallback iframe loaded:',
              frame.src
            );
          }
        );
      });
  }
);
</script>
</body>
</html>
`;

  return { html, width, height };
}
