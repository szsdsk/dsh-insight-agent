# Insight MCP 数据服务

[English](README.md) | 中文

本 Python 包为 InsightAgent 提供只读 MCP 工具。它登记工作区内的 CSV、XLSX、SQLite 和 DuckDB 数据源，运行受限 SQL，记录查询结果，并核验结果仍对应相同的文件内容。每次登记得到会话内的源 ID；可复用任务应保存路径和选定区域，而非该 ID。

`list_source_files` 在工作区内查找最多 100 个受支持的文件，并跳过依赖与构建目录。遍历达到上限时，`complete` 字段提示调用方指定更窄的目录。

`preview_table` 返回有限的物理行和工作表名称。`register_source` 可以指定单个表格的工作表、表头行及数据行范围。`diagnose_table` 报告空值、整行及键重复、无效数值和 Excel 公式缓存缺失。SQL 产生的发现包含数量、比例、分类和查询 ID。空值与重复行属于数据特征；只有用户定义了约束时才判为错误。数值冲突会阻止受影响指标的计算。SQL 统计与有限行样例共用查询 ID，并接受与用户查询相同的只读 SQL 校验。选定 Excel 区域会跨过空行保留工作表原始行号及单元格地址；选定 CSV 区域使用包含表头和跳过记录的记录编号。未指定区域的 CSV 导入仅提供选定表中的行序号。公式缓存样例引用源文件警告。`INSIGHT_DIAGNOSTIC_SAMPLE_LIMIT` 默认为 3，允许 1–10；每个样例最多展示八个值，超过 200 字符的值缩短，缩短内容或省略字段时都会明确标记。

`compare_tables` 将两份选定输入复制到受控的内存 DuckDB 表，按照确认过的字段对应和筛选条件计算总体及有限的维度分组。SQL 先对高基数分组排名，再返回 Top N 和可加总指标的“其他”行。支持求和、计数、去重计数和平均值。变化率要求基期为正；贡献率仅用于可加总指标。查询记录包含两份源文件的指纹；任一文件变化，`verify_query` 都会拒绝旧结果。SQL 和结果行保留在当前数据服务进程中，不作为持久任务记忆。

服务不会修改源文件。首版要求每个选定工作表有一个规则表头和一个数据区域；合并表头、多区块及小计识别需要人工选择区域或预处理文件。

使用 `python -m pip install -e "python/insight-mcp[dev]"` 安装，使用 `python -m pytest python/insight-mcp/tests` 运行定向检查。[产品指南](../../docs/insight-agent/README.zh.md)说明 Web 流程，[评测指南](../../evals/README.zh.md)说明冻结的办公案例。
