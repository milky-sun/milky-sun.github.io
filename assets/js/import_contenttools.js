// 使用立即执行函数，避免任何内部变量污染全局 Window 对象
(function() {
    var windowUrlSearch = window.location.search;
    var urlSearchParameters = new URLSearchParams(windowUrlSearch);
    var editParameterValue = urlSearchParameters.get('edit');

    // ---------------- 逃生舱：草稿清除指令拦截 ----------------
    // 防御性：在执行任何复杂逻辑前，优先处理销毁指令
    if (editParameterValue === 'clear') {
        try {
            localStorage.removeItem('editor-draft-html');
            alert('本地编辑器草稿已安全清除。即将重新加载页面。');
            
            // 剥离 URL 上的 clear 参数，阻断刷新时的死循环
            window.location.href = window.location.pathname;
        } catch (storageException) {
            console.warn(
                '清除草稿异常，可能受限于无痕模式：', 
                storageException
            );
            alert('清除草稿失败：无法访问本地存储。');
        }
        
        // 销毁指令执行完毕，彻底终止探针的后续解析
        return;
    }
    // 防御性：幽灵模式探测，彻底隔离普通访客与编辑者环境
    // 如果 URL 中没有包含 ?edit=true，探针立刻停止运行，零性能损耗
    if (editParameterValue !== 'true') {
        return;
    }

    // 尝试从本地存储中恢复上一次的未下载草稿
    var mainContentRegion = document.querySelector(
        'main[data-editable]'
    );
    var previousDraftHtml = localStorage.getItem('editor-draft-html');
    
    if (mainContentRegion && previousDraftHtml) {
        mainContentRegion.innerHTML = previousDraftHtml;
        console.info('检测到本地草稿，已自动为编辑器还原最新进度。');
    }

    // ---------------- 动态注入编辑器核心依赖 ----------------
    
    var stylesheetElement = document.createElement('link');
    stylesheetElement.rel = 'stylesheet';
    // 防御性：断行以满足严格的单行 75 字符限制，采用 CDN 引入
    // var stylesheetUrlBase = 'https://cdn.jsdelivr.net/npm/';
    // var stylesheetUrlPath = 'ContentTools@1.7.5/build/content-tools.min.css';
    // stylesheetElement.href = stylesheetUrlBase + stylesheetUrlPath;
    stylesheetElement.href = './assets/css/content-tools/content-tools.min1-6-16.css'
    document.head.appendChild(stylesheetElement);

    var javascriptElement = document.createElement('script');
    // var javascriptUrlPath = 'ContentTools@1.7.5/build/content-tools.min.js';
    // javascriptElement.src = stylesheetUrlBase + javascriptUrlPath;
    javascriptElement.src = './assets/js/content-tools/content-tools.min1-6-16.js'
    
    // 等待外部核心库加载完毕后，启动编辑器生命周期
    javascriptElement.onload = function() {
        initializeWysiwygEditor();
    };
    
    document.body.appendChild(javascriptElement);

    // ---------------- 核心编辑器生命周期管理 ----------------

    function initializeWysiwygEditor() {
        // 在编辑器初始化之前，优先挂载强硬接管的图片拦截器
        mountImageUploaderOverride();

        var wysiwygEditor = ContentTools.EditorApp.get();
        // 仅挂载到拥有 data-editable 属性的安全沙箱区域
        wysiwygEditor.init('*[data-editable]', 'data-name');

        wysiwygEditor.addEventListener('saved', function(savedEvent) {
            var modifiedRegions = savedEvent.detail().regions;
            
            // 防御拦截：如果没有任何实质修改，避免生成无意义的文件
            if (Object.keys(modifiedRegions).length === 0) {
                return;
            }

            wysiwygEditor.busy(true);

            // 遍历并覆写所有发生改变的沙箱区域
            for (var regionIdentifier in modifiedRegions) {
                if (modifiedRegions.hasOwnProperty(regionIdentifier)) {
                    var targetQuery = '[data-name="' + 
                        regionIdentifier + '"]';
                    var targetDomElement = document.querySelector(
                        targetQuery
                    );
                    
                    if (targetDomElement) {
                        var cleanHtmlContent = 
                            modifiedRegions[regionIdentifier];
                        
                        targetDomElement.innerHTML = cleanHtmlContent;
                        
                        // 混合存储第一层：静默写入本地存储
                        try {
                            localStorage.setItem(
                                'editor-draft-html', 
                                cleanHtmlContent
                            );
                        } catch (storageException) {
                            console.warn(
                                '草稿持久化拦截，可能处于无痕模式：', 
                                storageException
                            );
                        }
                    }
                }
            }

            // 混合存储第二层：触发物理文件下载
            executeHtmlFileDownload();

            wysiwygEditor.busy(false);
            new ContentTools.FlashUI('ok');
        });
    }

    // ---------------- 拦截器：极简防弹版图片加载 ----------------
    function mountImageUploaderOverride() {
        // 利用 ContentTools 官方钩子进行原型劫持
        ContentTools.IMAGE_UPLOADER = function(imageDialog) {
            
            // 防御性拦截：通过循环探针确保原版复杂的 UI 被强行隐藏
            var hideOriginalDialog = function() {
                var dialogDomNode = document.querySelector(
                    '.ct-image-dialog'
                );
                if (dialogDomNode) {
                    dialogDomNode.style.display = 'none';
                } else {
                    requestAnimationFrame(hideOriginalDialog);
                }
            };
            hideOriginalDialog();

            // 使用宏任务避开渲染阻塞，确保隐藏动作已绘制在屏幕上
            setTimeout(function() {
                var imageRelativePath = prompt(
                    '请输入图片相对路径 (例: ./assets/images/pic.jpg):'
                );

                if (imageRelativePath && imageRelativePath.trim() !== '') {
                    var cleanImagePath = imageRelativePath.trim();
                    
                    // 防御性：预载图片，计算真实尺寸，防止排版抖动
                    var preloaderImage = new Image();
                    
                    preloaderImage.onload = function() {
                        var imageWidth = preloaderImage.width;
                        var imageHeight = preloaderImage.height;
                        
                        // 获得尺寸后，安全地将 DOM 注入编辑器
                        imageDialog.save(
                            cleanImagePath, 
                            [imageWidth, imageHeight]
                        );
                    };
                    
                    preloaderImage.onerror = function() {
                        alert('图片读取失败，请检查相对路径。');
                        // 彻底销毁对话框上下文，防止编辑器死锁
                        if (typeof imageDialog.unmount === 'function') {
                            imageDialog.unmount();
                        }
                    };
                    
                    preloaderImage.src = cleanImagePath;
                } else {
                    // 用户点击取消或输入为空，安全卸载对象
                    if (typeof imageDialog.unmount === 'function') {
                        imageDialog.unmount();
                    }
                }
            }, 50);
        };
    }

    // ---------------- 物理文件打包与清洗引擎 ----------------
    
    function executeHtmlFileDownload() {
        var fullDocumentClone = document.documentElement.cloneNode(true);
        
        // 防御性清洗：彻底剔除编辑器运行时注入的各类 UI 脏组件
        var injectedWidgetSelector = 
            '.ct-widget, .ct-app, .ct-ignition';
        var dirtElementsList = fullDocumentClone.querySelectorAll(
            injectedWidgetSelector
        );
        
        dirtElementsList.forEach(function(dirtElement) {
            dirtElement.remove();
        });

        // 进一步清洗：移除元素上遗留的编辑状态 class 标签
        var editableElementsList = fullDocumentClone.querySelectorAll(
            '[data-editable]'
        );
        editableElementsList.forEach(function(editableElement) {
            editableElement.classList.remove(
                'ce-element', 
                'ce-element--focused'
            );
        });

        // 获取最纯净的代码，并补齐 HTML5 声明头
        var pureHtmlSourceCode = 
            '<!DOCTYPE html>\n' + fullDocumentClone.outerHTML;
        
        // 封装为 Blob 数据包并生成内存级 URL
        var htmlDataBlob = new Blob(
            [pureHtmlSourceCode], 
            { type: 'text/html;charset=utf-8' }
        );
        var memoryResourceUrl = URL.createObjectURL(htmlDataBlob);
        
        // 构建隐形锚点触发浏览器原生下载拦截
        var downloadAnchorElement = document.createElement('a');
        downloadAnchorElement.href = memoryResourceUrl;
        downloadAnchorElement.download = 'index_draft.html';
        
        document.body.appendChild(downloadAnchorElement);
        downloadAnchorElement.click();
        
        // 内存泄漏防御：延时销毁临时节点与资源定位符
        setTimeout(function() {
            document.body.removeChild(downloadAnchorElement);
            URL.revokeObjectURL(memoryResourceUrl);
        }, 150);
    }
})();