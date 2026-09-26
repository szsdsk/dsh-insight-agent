import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { insightWorkbench: InsightWorkbenchKey } }

/** Chinese text for the Insight workbench's local UI namespace. */
export const zh = {
  'type.label': '分析', 'guide.title': '分析工作台', 'guide.description': '拖拽字段、运行查询并查看证据', 'header.open': '打开分析工作台',
  'source.title': '数据源', 'source.path': '工作区内的数据文件路径', 'source.register': '导入数据', 'source.choose': '选择文件', 'source.kind': '格式',
  'source.csv': 'CSV', 'source.xlsx': 'XLSX', 'source.sqlite': 'SQLite', 'source.duckdb': 'DuckDB',
  'source.restore': '点击“导入数据”重新连接保存的数据文件并恢复分析配置；历史结果可继续查看和导出。',
  'fields.title': '数据与字段', 'fields.relation': '主表', 'fields.loading': '正在读取字段…',
  'config.title': '分析配置', 'config.dimension': '维度', 'config.metric': '指标', 'config.filter': '过滤', 'config.drop': '拖拽字段到这里，或点击左侧字段',
  'config.aggregation': '聚合', 'config.limit': 'Top N / 行数上限', 'config.run': '运行分析', 'config.running': '正在分析…', 'config.clear': '清空配置',
  'config.dateGrain': '日期粒度', 'config.noDateGrain': '原值', 'config.day': '日', 'config.month': '月', 'config.year': '年', 'config.operator': '运算符', 'config.sort': '排序与 Top N', 'config.noSort': '不排序',
  'config.asc': '升序', 'config.desc': '降序', 'config.sum': '求和', 'config.avg': '平均值', 'config.min': '最小值',
  'config.max': '最大值', 'config.count': '计数', 'config.countDistinct': '去重计数',
  'join.title': '关联第二张表', 'join.none': '不关联', 'join.kind': '关联方式', 'join.left': '主表关联字段', 'join.right': '右表唯一键',
  'join.leftKind': '左关联', 'join.innerKind': '内关联',
  'result.title': '结果', 'result.empty': '运行分析后，这里会显示图表和结果表。', 'result.noRows': '查询成功，但没有匹配的结果。',
  'result.table': '表格', 'result.bar': '柱状图', 'result.line': '折线图', 'result.scatter': '散点图', 'result.sql': 'SQL 与证据',
  'result.verified': '校验通过', 'result.snapshot': '历史快照', 'result.truncated': '结果已截断，请增加过滤或聚合后再绘图。',
  'result.rows': '行', 'result.ms': '毫秒', 'result.null': '空值', 'chart.x': '横轴字段', 'chart.y': '纵轴字段', 'chart.numericY': '纵轴请选择数值结果列。', 'chart.scatterNumeric': '散点图需要两个数值结果列，请调整横轴和纵轴。',
  'action.cancel': '取消', 'action.save': '保存', 'action.csv': '导出 CSV', 'action.png': '导出 PNG', 'action.explain': '解释当前结果', 'action.open': '在分析面板中打开',
  'action.explainPromptPrefix': '请解释分析结果', 'action.explainPromptSuffix': '。先调用 mcp__insight__get_query_result 读取并确认当前会话的已校验结果，再通过 submit_analysis 提交解释、关键发现和后续分析建议。',
  'status.saved': '已保存到工作区 .insight/', 'error.title': '分析失败', 'tool.query': 'Insight 查询', 'tool.analysis': 'Insight 解读',
} as const
/** Keys shared by both Insight workbench language dictionaries. */
export type InsightWorkbenchKey = keyof typeof zh
/** English text for the Insight workbench's local UI namespace. */
export const en: Record<InsightWorkbenchKey, string> = {
  'type.label': 'Analysis', 'guide.title': 'Analysis workbench', 'guide.description': 'Drag fields, run a query, and inspect its evidence', 'header.open': 'Open analysis workbench',
  'source.title': 'Data source', 'source.path': 'Data file path inside the workspace', 'source.register': 'Import data', 'source.choose': 'Choose file', 'source.kind': 'Format',
  'source.csv': 'CSV', 'source.xlsx': 'XLSX', 'source.sqlite': 'SQLite', 'source.duckdb': 'DuckDB',
  'source.restore': 'Import the saved data file to reconnect and restore the analysis configuration. Historical results remain available to view and export.',
  'fields.title': 'Data and fields', 'fields.relation': 'Primary table', 'fields.loading': 'Reading fields…',
  'config.title': 'Analysis configuration', 'config.dimension': 'Dimensions', 'config.metric': 'Metrics', 'config.filter': 'Filter', 'config.drop': 'Drop fields here, or click a field on the left',
  'config.aggregation': 'Aggregation', 'config.limit': 'Top N / row limit', 'config.run': 'Run analysis', 'config.running': 'Running…', 'config.clear': 'Clear configuration',
  'config.dateGrain': 'Date grain', 'config.noDateGrain': 'Original', 'config.day': 'Day', 'config.month': 'Month', 'config.year': 'Year', 'config.operator': 'Operator', 'config.sort': 'Sort and Top N', 'config.noSort': 'No sort',
  'config.asc': 'Ascending', 'config.desc': 'Descending', 'config.sum': 'Sum', 'config.avg': 'Average', 'config.min': 'Minimum',
  'config.max': 'Maximum', 'config.count': 'Count', 'config.countDistinct': 'Distinct count',
  'join.title': 'Join a second table', 'join.none': 'No join', 'join.kind': 'Join type', 'join.left': 'Primary join field', 'join.right': 'Unique right key',
  'join.leftKind': 'Left join', 'join.innerKind': 'Inner join',
  'result.title': 'Result', 'result.empty': 'Run an analysis to see a chart and result table.', 'result.noRows': 'The query succeeded but returned no rows.',
  'result.table': 'Table', 'result.bar': 'Bar', 'result.line': 'Line', 'result.scatter': 'Scatter', 'result.sql': 'SQL and evidence',
  'result.verified': 'Verified', 'result.snapshot': 'Historical snapshot', 'result.truncated': 'The result is truncated. Filter or aggregate before charting.',
  'result.rows': 'rows', 'result.ms': 'ms', 'result.null': 'NULL', 'chart.x': 'X-axis column', 'chart.y': 'Y-axis column', 'chart.numericY': 'Choose a numeric result column for the Y axis.', 'chart.scatterNumeric': 'Scatter plots need two numeric result columns. Adjust both axes.',
  'action.cancel': 'Cancel', 'action.save': 'Save', 'action.csv': 'Export CSV', 'action.png': 'Export PNG', 'action.explain': 'Explain current result', 'action.open': 'Open in analysis panel',
  'action.explainPromptPrefix': 'Explain analysis result', 'action.explainPromptSuffix': '. First call mcp__insight__get_query_result to read and confirm the verified result in this Session, then use submit_analysis to submit the interpretation, key findings, and suggested follow-up analyses.',
  'status.saved': 'Saved under workspace .insight/', 'error.title': 'Analysis failed', 'tool.query': 'Insight query', 'tool.analysis': 'Insight interpretation',
}
