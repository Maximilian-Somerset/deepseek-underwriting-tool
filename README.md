# DeepSeek智能核保辅助工具 v0.6

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 基于DeepSeek AI的智能核保辅助工具，自动从公开渠道收集企业信息并填写核保字段

## ✨ 功能特性

- 🤖 **AI驱动分析**：使用DeepSeek深度思考模型进行智能分析
- 🔍 **自动信息收集**：从年报、公告等公开渠道自动获取企业信息
- 📋 **多轮补查机制**：发现缺项后自动追加调查
- 🔒 **安全合规**：
  - API密钥Windows DPAPI加密存储
  - 遵守robots.txt爬虫规范
  - 拒绝访问私有IP和内网地址
- 📊 **完整审计**：详细的运行记录和证据链
- 🎯 **严格校验**：数值、年度、口径多重验证

## 🚀 快速开始

### 环境要求

- Windows 10/11
- Node.js 18.0+
- DeepSeek API密钥

### 安装步骤

1. **配置DeepSeek API密钥**
   ```cmd
   配置接口_v0.6.cmd
   ```

2. **准备输入Excel**
   - 参考 `测试_示例.xlsx` 的格式
   - 填写待核保的公司信息

3. **运行核保**
   ```cmd
   运行核保_DeepSeek_v0.6.cmd
   ```

## 📖 文档

- [完整使用说明](使用说明_DeepSeek_v0.6.md)
- [快速参考卡](v0.6快速参考.md)
- [隐私和数据使用](工具_v0.6/PRIVACY.md)

## 🔧 高级配置

编辑 `工具_v0.6/联网设置.json`：

```json
{
  "model": "deepseek-flash",
  "maxSearchRequests": 6,
  "maxReadAttempts": 10,
  "respectRobotsTxt": true
}
```

## ⚠️ 重要说明

### 数据使用

本工具会将以下信息发送到DeepSeek API：
- 公司名称
- 查询词（如"某某公司 2025 年度报告"）
- 爬取到的公开信息

详情请阅读 [PRIVACY.md](工具_v0.6/PRIVACY.md)

### 输出说明

- **所有输出仅作为候选**，需要人工复核
- 状态标注说明结果来源（材料/网页/搜索摘要/推断）
- 不能直接用于最终核保决策

## 💰 成本参考

每家公司预估（启用缓存后大幅降低）：
- DeepSeek Search: 6次 × ¥0.1 ≈ ¥0.6
- DeepSeek Fetch: 4次 × ¥0.1 ≈ ¥0.4  
- AI分析: 3轮 × ¥0.1 ≈ ¥0.3
- **总计：约¥1-2.5/公司**

## 🛠️ 技术架构

- **语言**：Node.js (ES Modules), PowerShell
- **AI模型**：DeepSeek (deepseek-flash)
- **Excel处理**：@microsoft/generator-excel
- **网络请求**：原生fetch + 自定义爬虫

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 🤝 贡献

欢迎提交Issue和Pull Request！

请注意：
- 不要在PR中包含真实公司数据
- 遵循现有代码风格
- 添加适当的注释

## ⚠️ 免责声明

本工具仅供参考，输出结果需要人工复核。使用者应：
- 确保有权处理相关公司信息
- 遵守所在地区的数据保护法律
- 自行评估API调用的合规性
- 对输出结果的使用负责

## 📞 支持

遇到问题请提交 [Issue](https://github.com/Maximilian-Somerset/deepseek-underwriting-tool/issues)

---

**版本**：v0.6.0  
**最后更新**：2026-11-23
