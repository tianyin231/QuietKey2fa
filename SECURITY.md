# 安全报告

发现可能泄露原始密钥、绕过锁定、破坏加密或覆盖账号数据的问题，请通过 [GitHub 私密漏洞报告](https://github.com/tianyin231/QuietKey2fa/security/advisories/new) 联系维护者。

请提供受影响版本或提交、浏览器与系统版本、最小复现步骤，以及使用虚构账号制作的示例。不要在公开 Issue 中提交漏洞利用细节或真实密钥、二维码、主密码、备份文件。

普通界面问题和功能建议可使用 [Issue 模板](https://github.com/tianyin231/QuietKey2fa/issues/new/choose)。

## 维护范围

安全修复优先在 `main` 和最新正式版本中提供。使用旧版本时，请先核对 [最新发布](https://github.com/tianyin231/QuietKey2fa/releases/latest) 是否已修复；项目暂不承诺固定的响应或修复时限。

## 安全边界

- 主密码不保存，也无法找回；清理站点存储可能移除本地保险库。
- 本地加密保护保存的数据，不能防护已被控制的设备、恶意扩展或已解锁页面中的恶意脚本。
- 明文导出包含可生成验证码的原始密钥，应由使用者妥善保管。
- 项目尚未经过独立安全审计；具体数据流见 [README](./README.md#数据与安全)。
