/* eslint-disable max-lines-per-function */
'use strict';

import powerbiApi from 'powerbi-visuals-api';
import DataView = powerbiApi.DataView;
import IVisualHost = powerbiApi.extensibility.visual.IVisualHost;
import IVisual = powerbiApi.extensibility.IVisual;
import DataViewMetadataColumn = powerbiApi.DataViewMetadataColumn;
import DataViewValueColumnGroup = powerbiApi.DataViewValueColumnGroup;
import DataViewCategoryColumn = powerbiApi.DataViewCategoryColumn;
import PrimitiveValue = powerbiApi.PrimitiveValue;
import IViewport = powerbiApi.IViewport;
import VisualUpdateOptions = powerbiApi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbiApi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateType = powerbiApi.VisualUpdateType;
import VisualObjectInstanceEnumeration = powerbiApi.VisualObjectInstanceEnumeration;
import VisualObjectInstanceEnumerationObject = powerbiApi.VisualObjectInstanceEnumerationObject;
import VisualObjectInstance = powerbiApi.VisualObjectInstance;
import EnumerateVisualObjectInstancesOptions = powerbiApi.EnumerateVisualObjectInstancesOptions;

import {interactivityBaseService, interactivitySelectionService} from 'powerbi-visuals-utils-interactivityutils';
import IInteractivityService = interactivityBaseService.IInteractivityService;
import ISelectionHandler = interactivityBaseService.ISelectionHandler;
import createInteractivityService = interactivitySelectionService.createInteractivitySelectionService;
import IInteractiveBehavior = interactivityBaseService.IInteractiveBehavior;

import {RenderVisual} from './render/renderVisual';
import {RenderAxes} from './render/renderAxes';
import {axis} from 'powerbi-visuals-utils-chartutils';

import {
    interfaces,
    valueFormatter as ValueFormatter,
    valueFormatter,
    textMeasurementService,
} from 'powerbi-visuals-utils-formattingutils';
import TextProperties = interfaces.TextProperties;
import IValueFormatter = ValueFormatter.IValueFormatter;

import * as visualUtils from './utils';
import * as scrollbarUtil from './scrollbarUtil';
import * as metadataUtils from './metadataUtils';
import * as legendUtils from './utils/legendUtils';
import * as axisUtils from './utils/axis/yAxisUtils';
import * as lassoSelectionUtil from './lassoSelectionUtil';
import * as selectionSaveUtils from './selectionSaveUtils';
import {WebBehavior, WebBehaviorOptions} from './behavior';

import ScrollbarState = scrollbarUtil.ScrollbarState;

import {CssConstants, IMargin, manipulation as svg} from 'powerbi-visuals-utils-svgutils';

import * as d3 from 'd3-selection';
import {d3Selection, d3Update} from './utils';

import '../style/visual.less';

import {
    AxisRangeType,
    LabelPosition,
    LayoutMode,
    legendSettings,
    smallMultipleSettings,
    VisualSettings,
} from './settings';
import {
    AxesDomains,
    CategoryDataPoints,
    IAxes,
    IAxesSize,
    ISize,
    LegendProperties,
    LegendSize,
    SmallMultipleSizeOptions,
    VisualData,
    VisualDataPoint,
    VisualMeasureMetadata,
    VisualTranslation,
} from './visualInterfaces';

import {CustomLegendBehavior} from './customLegendBehavior';

import {legendInterfaces} from 'powerbi-visuals-utils-chartutils';
import ILegend = legendInterfaces.ILegend;
import LegendDataPoint = legendInterfaces.LegendDataPoint;

import {legend} from 'powerbi-visuals-utils-chartutils';
import createLegend = legend.createLegend;

import {DataViewConverter, Field} from './dataViewConverter';
import {EnumerateObject} from './enumerateObject';
import {ITooltipServiceWrapper, createTooltipServiceWrapper} from 'powerbi-visuals-utils-tooltiputils';

import {pixelConverter as PixelConverter} from 'powerbi-visuals-utils-typeutils';

import {LassoSelectionForSmallMultiple} from './lassoSelectionUtilForSmallMultiple';

class Selectors {
    public static MainSvg = CssConstants.createClassAndSelector('bar-chart-svg');
    public static VisualSvg = CssConstants.createClassAndSelector('bar-chart-visual');
    public static BarSelect = CssConstants.createClassAndSelector('bar');
    public static BarGroupSelect = CssConstants.createClassAndSelector('bar-group');
    public static AxisGraphicsContext = CssConstants.createClassAndSelector('axisGraphicsContext');
    public static AxisLabelSelector = CssConstants.createClassAndSelector('axisLabel');
    public static LabelGraphicsContext = CssConstants.createClassAndSelector('labelGraphicsContext');
    public static LabelBackgroundContext = CssConstants.createClassAndSelector('labelBackgroundContext');
}

export class Visual implements IVisual {
    public static DefaultColor: string = '#777777';

    private allDataPoints: VisualDataPoint[];
    public categoriesCount: number;

    public viewport: IViewport;

    public webBehaviorSelectionHandler: ISelectionHandler;

    private mainHtmlElement: HTMLElement;
    private mainElement: d3Selection<any>;
    private mainDivElement: d3Selection<any>;
    private barGroup: d3Selection<SVGElement>;
    private chartsContainer: d3Selection<SVGElement>;
    private axisGraphicsContext: d3Selection<SVGElement>;
    private xAxisSvgGroup: d3Selection<SVGElement>;
    private yAxisSvgGroup: d3Selection<SVGElement>;

    private axisLabelsGroup: d3Update<string>;
    private legendElement: d3Selection<SVGElement>;
    private legendElementRoot: d3Selection<SVGElement>;

    public readonly barClassName: string = Selectors.BarSelect.className;
    private labelGraphicsContext: d3Selection<any>;
    private labelBackgroundContext: d3Selection<any>;

    public scrollBar: scrollbarUtil.ScrollBar = new scrollbarUtil.ScrollBar(this);

    private BarHeight: number = 0;

    public settings: VisualSettings;
    public host: IVisualHost;
    private dataView: DataView;
    private data: VisualData;
    public visualSize: ISize;
    public visualMargin: IMargin;
    private legend: ILegend;
    public legendSize;
    public maxYLabelsWidth;

    public static DefaultStrokeSelectionColor: string = '#000';
    public static DefaultStrokeWidth: number = 1;
    public static DefaultStrokeSelectionWidth: number = 1;

    public yTickOffset: number;
    public xTickOffset: number;

    private behavior: IInteractiveBehavior;
    private interactivityService: IInteractivityService<any>;

    private clearCatcher: d3Selection<any>;
    private tooltipServiceWrapper: ITooltipServiceWrapper;

    private hasHighlight: boolean;
    public isLegendNeeded: boolean;
    private isSelectionRestored: boolean = false;

    private metadata: VisualMeasureMetadata;

    private lassoSelection: lassoSelectionUtil.LassoSelection = new lassoSelectionUtil.LassoSelection(this);
    private LassoSelectionForSmallMultiple: LassoSelectionForSmallMultiple = new LassoSelectionForSmallMultiple(Selectors.BarSelect, this);

    private visualTranslation: VisualTranslation;

    private dataPointsByCategories: CategoryDataPoints[];

    private legendProperties: LegendProperties;

    // normal chart
    private mainSvgElement: d3Selection<any>;


    private readonly axesSize: IAxesSize = {xAxisHeight: 10, yAxisWidth: 15};

    constructor(options: VisualConstructorOptions) {
        // Create d3 selection from main HTML element
        this.mainElement = d3.select(options.element);

        this.mainHtmlElement = options.element;

        this.host = options.host;

        this.tooltipServiceWrapper = createTooltipServiceWrapper(
            options.host.tooltipService,
            options.element);

        this.interactivityService = createInteractivityService(this.host);

        const customLegendBehavior = new CustomLegendBehavior(this.saveSelection.bind(this));
        this.legend = createLegend(
            this.mainHtmlElement,
            false,
            this.interactivityService,
            true,
            null,
            customLegendBehavior,
        );

        this.behavior = new WebBehavior(this);

        this.legendElementRoot = this.mainElement.selectAll('svg.legend');
        this.legendElement = this.mainElement.selectAll('svg.legend').selectAll('g');
    }

    saveSelection(): void {
        const selected = this.mainElement.selectAll(`.legendItem, ${Selectors.BarSelect.selectorName}`)
            .filter((d: LegendDataPoint) => d.selected);

        const data: any[] = selected.data();

        selectionSaveUtils.saveSelection(data, this.host);
    }

    private prepareMainSvgElementForNormalChart(): void {
        if (this.mainDivElement) {
            this.mainDivElement.remove();
            this.mainDivElement = null;
        }

        // This SVG will contain our visual
        if (this.mainSvgElement) {
            this.mainSvgElement.selectAll('*').remove();
        } else {
            this.mainSvgElement = this.mainElement.append('svg')
                .classed(Selectors.MainSvg.className, true)
                .attr('width', '100%')
                .attr('height', '100%');
        }
    }

    private createNormalChartElements(): void {
        this.prepareMainSvgElementForNormalChart();

        this.chartsContainer = this.mainSvgElement.append('g').attr('id', 'chartsContainer');

        // Append SVG groups for X and Y axes.
        this.xAxisSvgGroup = this.chartsContainer.append('g').attr('id', 'xAxisSvgGroup');
        this.yAxisSvgGroup = this.chartsContainer.append('g').attr('id', 'yAxisSvgGroup');
        // Append an svg group that will contain our visual
        this.barGroup = this.chartsContainer.append('g').attr('id', 'barGroup');

        this.axisGraphicsContext = this.chartsContainer
            .append('g')
            .attr('class', Selectors.AxisGraphicsContext.className);

        this.labelBackgroundContext = this.chartsContainer
            .append('g')
            .classed(Selectors.LabelBackgroundContext.className, true);

        this.labelGraphicsContext = this.chartsContainer
            .append('g')
            .classed(Selectors.LabelGraphicsContext.className, true);

        this.mainElement.select('.scrollbar-track').remove();

        this.scrollBar.init(this.mainElement);
    }

    public clearAll() {
        if (this.isSmallMultiple()) {
            this.mainElement.selectAll('.selection-rect').remove();
            this.mainDivElement.selectAll('*').remove();
        } else {
            this.barGroup && this.barGroup.selectAll(Selectors.BarGroupSelect.selectorName).remove();
            this.xAxisSvgGroup && this.xAxisSvgGroup.selectAll('*').remove();
            this.yAxisSvgGroup && this.yAxisSvgGroup.selectAll('*').remove();
            this.legendElement && this.legendElement.selectAll('*').remove();
            this.labelGraphicsContext && this.labelGraphicsContext.selectAll('*').remove();
            this.labelBackgroundContext && this.labelBackgroundContext.selectAll('*').remove();
        }
    }

    private optionsAreValid(options: VisualUpdateOptions) {
        const dataView = options && options.dataViews && options.dataViews[0];

        if (!dataView || options.type === VisualUpdateType.ResizeEnd) {
            return;
        }

        if (!DataViewConverter.IsCategoryFilled(dataView, Field.Axis) || !DataViewConverter.IsCategoryFilled(dataView, Field.Axis)) {
            this.clearAll();
            return;
        }

        return true;
    }

    private calculateLabelsSize(settings: smallMultipleSettings): number {
        return settings.showChartTitle ? 120 : 0;
    }

    private calculateTopSpace(settings: smallMultipleSettings): number {

        if (!settings.showChartTitle) {
            return 0;
        }

        const textProperties: TextProperties = {
            fontFamily: settings.fontFamily,
            fontSize: PixelConverter.toString(settings.fontSize),
        };

        const height: number = textMeasurementService.measureSvgTextHeight(textProperties),
            additionalSpace: number = settings.layoutMode === LayoutMode.Flow ? 15 : 0;

        return height + additionalSpace;
    }

    private isSmallMultiple(): boolean {
        return !!this.metadata && (this.metadata.idx.columnBy > -1 || this.metadata.idx.rowBy > -1);
    }

    private calculateChartSize(viewport: IViewport,
                               settings: smallMultipleSettings,
                               leftSpace: number,
                               topSpace: number,
                               rows: number,
                               columns: number,
                               legendSize: LegendSize): SmallMultipleSizeOptions {

        const scrollHeight: number = 23,
            scrollWidth: number = 20,
            gapBetweenCharts: number = 10;
        const minHeight: number = settings.minUnitHeight,
            minWidth: number = settings.minUnitWidth;

        let chartHeight: number = 0;
        let chartWidth: number = 0;

        if (settings.layoutMode === LayoutMode.Matrix) {
            const clientHeight: number = viewport.height - topSpace - scrollHeight - legendSize.height;
            const clientWidth: number = viewport.width - leftSpace - scrollWidth - legendSize.width;

            chartHeight = (clientHeight - gapBetweenCharts * rows) / rows;
            chartWidth = (clientWidth - gapBetweenCharts * columns) / columns;
        } else {
            const clientHeight: number = viewport.height - scrollHeight - legendSize.height;
            const clientWidth: number = viewport.width - leftSpace - scrollWidth - legendSize.width;

            chartHeight = (clientHeight - gapBetweenCharts * rows - topSpace * rows) / rows;
            chartWidth = (clientWidth - gapBetweenCharts * (columns)) / columns;
        }

        const isVerticalScrollBarNeeded: boolean = chartHeight < minHeight - scrollWidth / rows,
            isHorizontalScrollBarNeeded: boolean = chartWidth < minWidth - scrollHeight / columns;

        if (!isVerticalScrollBarNeeded) {
            chartWidth += scrollHeight / columns;
        }

        if (!isHorizontalScrollBarNeeded) {
            chartHeight += scrollWidth / rows;
        }

        return {
            height: isVerticalScrollBarNeeded ? minHeight : chartHeight,
            width: isHorizontalScrollBarNeeded ? minWidth : chartWidth,
            isHorizontalSliderNeeded: isHorizontalScrollBarNeeded,
            isVerticalSliderNeeded: isVerticalScrollBarNeeded,
        };
    }

    public prepareMainDiv(el: d3Selection<any>) {
        if (this.mainSvgElement) {
            this.mainSvgElement.remove();
            this.mainSvgElement = null;
        }

        if (this.mainDivElement) {
            this.mainDivElement.selectAll('*').remove();
        } else {
            this.mainDivElement = el.append('div');
        }
    }

    public calculateYAxisSize(values: PrimitiveValue[], settings: VisualSettings, metadata: VisualMeasureMetadata): number {
        let formatter: IValueFormatter;

        if (values.some(x => x && typeof ((<any>x).getMonth) === 'function')) {
            if (metadata.cols.category) {
                formatter = valueFormatter.create({
                    format: valueFormatter.getFormatStringByColumn(<any>metadata.cols.category, true) || metadata.cols.category.format,
                    cultureSelector: this.host.locale,
                });
            } else if (metadata.groupingColumn) {
                formatter = valueFormatter.create({
                    format: valueFormatter.getFormatStringByColumn(<any>metadata.groupingColumn, true) || metadata.groupingColumn.format,
                    cultureSelector: this.host.locale,
                });
            }
        } else {
            const yAxisFormatString: string = valueFormatter.getFormatStringByColumn(<any>metadata.cols.category) || valueFormatter.getFormatStringByColumn(<any>metadata.groupingColumn);

            formatter = valueFormatter.create({format: yAxisFormatString});
        }

        const fontSize: string = PixelConverter.toString(settings.categoryAxis.fontSize);
        const fontFamily: string = settings.categoryAxis.fontFamily;

        let maxWidth: number = 0;

        values.forEach(value => {
            const textProperties: TextProperties = {
                text: formatter.format(value),
                fontFamily: fontFamily,
                fontSize: fontSize,
            };

            const width: number = textMeasurementService.measureSvgTextWidth(textProperties);
            maxWidth = width > maxWidth ? width : maxWidth;
        });

        return maxWidth;
    }

    public calculateXAxisSize(settings: VisualSettings): number {

        const fontSize: string = PixelConverter.toString(settings.valueAxis.fontSize);
        const fontFamily: string = settings.valueAxis.fontFamily;

        const textProperties: TextProperties = {
            fontFamily: fontFamily,
            fontSize: fontSize,
        };

        const height: number = textMeasurementService.measureSvgTextHeight(textProperties);

        return height + 8;
    }

    public smallMultipleProcess(viewport: IViewport) {
        const uniqueColumns: PrimitiveValue[] = this.allDataPoints.map(x => x.columnBy).filter((v, i, a) => a.indexOf(v) === i);
        const uniqueRows: PrimitiveValue[] = this.allDataPoints.map(x => x.rowBy).filter((v, i, a) => a.indexOf(v) === i);
        const uniqueCategories: PrimitiveValue[] = this.allDataPoints.map(x => x.category).filter((v, i, a) => a.indexOf(v) === i);

        const leftSpace: number = uniqueRows && uniqueRows.length === 1 && uniqueRows[0] === null ? 0 : this.calculateLabelsSize(this.settings.smallMultiple);
        const topSpace: number = this.calculateTopSpace(this.settings.smallMultiple);

        const hasHighlight = this.allDataPoints.filter(x => x.highlight).length > 0;

        const marginLeft: number = 10;
        let yAxisSize: number = this.calculateYAxisSize(uniqueCategories, this.settings, this.metadata);
        const xAxisSize: number = this.calculateXAxisSize(this.settings);

        const gapBetweenCharts: number = 10;

        this.prepareMainDiv(this.mainElement);
        this.mainElement.select('.scrollbar-track').remove();

        let legendSize: LegendSize = {
            width: 0,
            height: 0,
        };

        if (this.isLegendNeeded) {
            legendUtils.renderLegend(this.legend, this.mainDivElement, this.viewport, this.legendProperties);
            legendSize = this.calculateLegendSize(this.settings.legend, this.legendElementRoot);
        } else {
            this.legendElement && this.legendElement.selectAll('*').remove();
            this.mainDivElement && this.mainDivElement
                .style('margin-top', 0)
                .style('margin-botto', 0)
                .style('margin-left', 0)
                .style('margin-right', 0);

            legendSize = {
                height: 0,
                width: 0,
            };
        }

        const layoutMode: LayoutMode = this.settings.smallMultiple.layoutMode;
        const maxRowWidth: number = this.settings.smallMultiple.maxRowWidth;

        const rowsInFlow: number = uniqueColumns.length <= maxRowWidth ? 1 : (Math.floor(uniqueColumns.length / maxRowWidth) + (uniqueColumns.length % maxRowWidth > 0 ? 1 : 0));

        const columns: number = layoutMode === LayoutMode.Matrix ? uniqueColumns.length : Math.min(uniqueColumns.length, maxRowWidth);
        const rows: number = layoutMode === LayoutMode.Matrix ? uniqueRows.length : rowsInFlow * uniqueRows.length;

        const chartSize: SmallMultipleSizeOptions = this.calculateChartSize(viewport, this.settings.smallMultiple, leftSpace, topSpace, rows, columns, legendSize);
        const barsSectionSize: ISize = {
            height: chartSize.height - xAxisSize - gapBetweenCharts,
            width: chartSize.width - yAxisSize - gapBetweenCharts * 2,
        };

        this.mainDivElement
            .style('width', viewport.width - legendSize.width + 'px')
            .style('height', viewport.height - legendSize.height + 'px')
            .style('overflow-x', chartSize.isHorizontalSliderNeeded ? 'auto' : 'hidden')
            .style('overflow-y', chartSize.isVerticalSliderNeeded ? 'auto' : 'hidden');

        const maxLabelWidth: number = (chartSize.width) / 100 * this.settings.categoryAxis.maximumSize;
        if (this.settings.categoryAxis.maximumSize) {
            if (yAxisSize > maxLabelWidth) {
                barsSectionSize.width += yAxisSize;
                yAxisSize = maxLabelWidth;
                barsSectionSize.width -= yAxisSize;
            }
        }

        let axes: IAxes;

        const yIsSeparate: boolean = this.settings.categoryAxis.rangeType === AxisRangeType.Separate;
        const xIsSeparate: boolean = this.settings.valueAxis.rangeType === AxisRangeType.Separate;

        const xIsCustom: boolean = this.settings.valueAxis.rangeType === AxisRangeType.Custom;
        const yIsCustom: boolean = this.settings.categoryAxis.rangeType === AxisRangeType.Custom;

        const defaultXDomain: any[] = RenderAxes.calculateValueDomain(this.allDataPoints, this.settings, true);
        const defaultYDomain: any[] = RenderAxes.calculateCategoryDomain(this.allDataPoints, this.settings, this.metadata, true);

        const defaultAxes: IAxes = this.createSmallMultipleAxesByDomains(defaultYDomain, defaultXDomain, barsSectionSize, maxLabelWidth, uniqueCategories.length);

        let xDomain: any[] = [],
            yDomain: any[] = [];

        if (!yIsSeparate && !xIsSeparate) {
            axes = defaultAxes;
        } else {
            if (!yIsSeparate) {
                yDomain = defaultYDomain;
            }

            if (!xIsSeparate) {
                xDomain = defaultXDomain;
            }
        }

        this.data = {
            axes: axes,
            dataPoints: this.allDataPoints,
            hasHighlight: hasHighlight,
            isLegendNeeded: this.isLegendNeeded,
            legendData: this.legendProperties.data,
            categoriesCount: null,
            isSmallMultiple: this.isSmallMultiple(),
        };

        let svgHeight: number = 0,
            svgWidth: number = 0;

        if (layoutMode === LayoutMode.Matrix) {
            svgHeight = topSpace + rows * chartSize.height + gapBetweenCharts * (rows),
                svgWidth = leftSpace + columns * chartSize.width + gapBetweenCharts * (columns);
        } else {
            svgHeight = topSpace * rows + rows * chartSize.height + gapBetweenCharts * (rows - 1),
                svgWidth = leftSpace + columns * chartSize.width + gapBetweenCharts * (columns);
        }

        const svgChart = this.mainDivElement
            .append('svg')
            .classed('chart', true)
            .style('width', svgWidth + 'px')
            .style('height', svgHeight + 'px');

        for (let i = 0; i < uniqueRows.length; ++i) {
            for (let j = 0; j < uniqueColumns.length; ++j) {
                let leftMove: number = 0;
                let topMove: number = 0;

                if (layoutMode === LayoutMode.Matrix) {
                    leftMove = gapBetweenCharts / 2 + j * chartSize.width + gapBetweenCharts * j;
                    topMove = topSpace + i * chartSize.height + gapBetweenCharts * i;
                } else {
                    const xPosition: number = Math.floor(j % maxRowWidth);
                    const yPosition: number = Math.floor(j / maxRowWidth) + i * rowsInFlow;

                    leftMove = xPosition * chartSize.width + gapBetweenCharts * xPosition;
                    topMove = yPosition * chartSize.height + gapBetweenCharts * yPosition + topSpace * yPosition + gapBetweenCharts / 2;
                }

                const dataPoints: VisualDataPoint[] = this.allDataPoints.filter(x => x.rowBy === uniqueRows[i]).filter(x => x.columnBy === uniqueColumns[j]);

                const chart = svgChart
                    .append('g')
                    .attr('transform', svg.translate(leftSpace + leftMove, topMove + topSpace));

                const xAxisSvgGroup: d3Selection<SVGElement> = chart.append('g');
                const yAxisSvgGroup: d3Selection<SVGElement> = chart.append('g');

                const yHasRightPosition: boolean = this.settings.categoryAxis.show && this.settings.categoryAxis.position === 'right';

                xAxisSvgGroup.attr(
                    'transform',
                    svg.translate(
                        marginLeft +
                        (yHasRightPosition ? 0 : yAxisSize),
                        barsSectionSize.height));

                yAxisSvgGroup.attr(
                    'transform',
                    svg.translate(
                        marginLeft +
                        (yHasRightPosition ? barsSectionSize.width : yAxisSize),
                        0));

                const barHeight: number = this.getBarHeight(dataPoints, chartSize, dataPoints.length);

                if (yIsSeparate || xIsSeparate) {
                    if (!dataPoints || !dataPoints.length) {
                        axes = defaultAxes;
                    }

                    if (yIsSeparate) {
                        yDomain = dataPoints && dataPoints.length ? RenderAxes.calculateCategoryDomain(dataPoints, this.settings, this.metadata, true) : defaultYDomain;
                    }

                    if (xIsSeparate) {
                        xDomain = dataPoints && dataPoints.length ? RenderAxes.calculateValueDomain(dataPoints, this.settings, true) : defaultXDomain;
                    }

                    if (!yIsSeparate && !xIsSeparate) {
                        axes = defaultAxes;
                    } else {
                        const uniqueCategoriesCount: number = dataPoints.map(x => x.category).filter((v, i, a) => a.indexOf(v) === i).length;
                        axes = this.createSmallMultipleAxesByDomains(yDomain, xDomain, barsSectionSize, maxLabelWidth, uniqueCategoriesCount);
                    }
                }

                if (!this.data.axes) {
                    this.data.axes = defaultAxes;
                }

                this.renderSmallMultipleAxes(dataPoints, axes, xAxisSvgGroup, yAxisSvgGroup, barHeight);

                if (xIsCustom) {
                    let divider: number = 1;
                    const xText = xAxisSvgGroup.selectAll('text')[0];

                    const axisWidth = (xText.parentNode as SVGGraphicsElement).getBBox().width;
                    const maxTextWidth = visualUtils.getLabelsMaxWidth(xText);

                    for (let i = 0; i < xText.length; ++i) {
                        const actualAllAxisTextWidth: number = maxTextWidth * xText.length / divider;

                        if (actualAllAxisTextWidth > axisWidth) {
                            divider += 1;
                        } else {
                            break;
                        }
                    }

                    for (let i = 0; i < xText.length; ++i) {
                        if (i % divider > 0) {
                            d3.select(xText[i]).remove();
                        }
                    }
                }

                if (yIsCustom) {
                    let divider: number = 1;
                    const yText = yAxisSvgGroup.selectAll('text')[0];

                    const axisWidth = (yText.parentNode as SVGGraphicsElement).getBBox().width;
                    const maxTextWidth = visualUtils.getLabelsMaxHeight(yText);

                    for (let i = 0; i < yText.length; ++i) {
                        const actualAllAxisTextWidth: number = maxTextWidth * yText.length / divider;

                        if (actualAllAxisTextWidth > axisWidth) {
                            divider += 1;
                        } else {
                            break;
                        }
                    }

                    for (let i = 0; i < yText.length; ++i) {
                        if (i % divider > 0) {
                            d3.select(yText[i]).remove();
                        }
                    }
                }

                const barGroup = chart
                    .append('g')
                    .classed('bar-group', true)
                    .attr(
                        'transform', svg.translate(marginLeft + (yHasRightPosition ? 0 : yAxisSize), 0),
                    );

                const interactivityService = this.interactivityService,
                    hasSelection: boolean = interactivityService.hasSelection();
                interactivityService.applySelectionStateToData(dataPoints);

                const barSelect = barGroup
                    .selectAll(Selectors.BarSelect.selectorName)
                    .data(dataPoints);

                barSelect.exit()
                    .remove();

                const barSelectEnter = barSelect.enter().append('rect')
                    .attr('class', Selectors.BarSelect.className);

                barSelect
                    .merge(barSelectEnter)
                    .attr('height', d => {
                        return d.barCoordinates.height;
                    })
                    .attr('width', d => {
                        return d.barCoordinates.width;
                    })
                    .attr('x', d => {
                        return d.barCoordinates.x;
                    })
                    .attr('y', d => {
                        return d.barCoordinates.y;
                    })
                    .attr('fill', d => d.color)
                    .style('fill-opacity', (p: VisualDataPoint) => visualUtils.getFillOpacity(
                        p.selected,
                        p.highlight,
                        !p.highlight && hasSelection,
                        !p.selected && hasHighlight))
                    .style('stroke', (p: VisualDataPoint) => {
                        if ((hasHighlight || hasSelection) && visualUtils.isSelected(p.selected,
                            p.highlight,
                            !p.highlight && hasSelection,
                            !p.selected && hasHighlight)) {
                            return Visual.DefaultStrokeSelectionColor;
                        }

                        return p.color;
                    })
                    .style('stroke-width', p => {
                        if ((hasHighlight || hasSelection) && visualUtils.isSelected(p.selected,
                            p.highlight,
                            !p.highlight && hasSelection,
                            !p.selected && hasHighlight)) {
                            return Visual.DefaultStrokeSelectionWidth;
                        }

                        return Visual.DefaultStrokeWidth;
                    });

                RenderVisual.renderTooltip(barSelect, this.tooltipServiceWrapper);

                visualUtils.calculateLabelCoordinates(
                    this.data,
                    this.settings.categoryLabels,
                    this.metadata,
                    chartSize.width,
                    this.isLegendNeeded,
                    dataPoints,
                );

                const labelGraphicsContext = barGroup
                    .append('g')
                    .classed(Selectors.LabelGraphicsContext.className, true);

                RenderVisual.renderDataLabels(
                    this.data,
                    this.settings,
                    labelGraphicsContext,
                    this.metadata,
                    dataPoints,
                );

                const labelBackgroundContext = barGroup
                    .append('g')
                    .classed(Selectors.LabelBackgroundContext.className, true);

                RenderVisual.renderDataLabelsBackground(
                    this.data,
                    this.settings,
                    labelBackgroundContext,
                    dataPoints,
                );

                if (this.settings.smallMultiple.showChartTitle && layoutMode === LayoutMode.Flow) {
                    RenderVisual.renderSmallMultipleTopTitle({
                        chartElement: svgChart,
                        chartSize: chartSize,
                        columns: uniqueColumns,
                        index: j,
                        leftSpace: leftMove + leftSpace,
                        topSpace: topMove,
                        textHeight: topSpace,
                        rows: uniqueRows,
                        xAxisLabelSize: xAxisSize,
                    }, this.settings.smallMultiple);
                }

                const yHeight: number = (<Element>xAxisSvgGroup.selectAll('line').node()).getBoundingClientRect().height;
                if (axes.x.dataDomain[0] < this.settings.constantLine.value && this.settings.constantLine.value < axes.x.dataDomain[1]) {
                    RenderVisual.renderConstantLine(this.settings.constantLine, barGroup, axes, yHeight);
                }
            }
        }

        if (this.settings.smallMultiple.showSeparators) {
            RenderVisual.renderSmallMultipleLines({
                chartElement: svgChart,
                chartSize: chartSize,
                columns: uniqueColumns,
                rows: uniqueRows,
                leftSpace: leftSpace,
                topSpace: topSpace,
                xAxisLabelSize: xAxisSize,
                rowsInFlow: rowsInFlow,
            }, this.settings.smallMultiple);
        }

        if (this.settings.smallMultiple.showChartTitle) {
            RenderVisual.renderSmallMultipleTitles({
                chartElement: svgChart,
                chartSize: chartSize,
                columns: uniqueColumns,
                leftSpace: leftSpace,
                topSpace: topSpace,
                rows: uniqueRows,
                xAxisLabelSize: xAxisSize,
                rowsInFlow: rowsInFlow,
            }, this.settings.smallMultiple);
        }

        const legendBucketFilled: boolean = !!(this.dataView.categorical && this.dataView.categorical.values && this.dataView.categorical.values.source);
        this.lassoSelection.disable();
        this.LassoSelectionForSmallMultiple.init(this.mainElement);
        this.LassoSelectionForSmallMultiple.update(svgChart, svgChart.selectAll(Selectors.BarSelect.selectorName), legendBucketFilled);

        if (this.interactivityService) {
            this.interactivityService.applySelectionStateToData(this.allDataPoints);

            const behaviorOptions: WebBehaviorOptions = {
                bars: this.mainElement.selectAll(Selectors.BarSelect.selectorName),
                clearCatcher: d3.select(document.createElement('div')),
                interactivityService: this.interactivityService,
                host: this.host,
                selectionSaveSettings: this.settings.selectionSaveSettings,
                dataPoints: this.allDataPoints,
                behavior: this.behavior,
            };

            this.interactivityService.bind(behaviorOptions);
        }
    }

    normalChartProcess(options: VisualUpdateOptions): void {
        this.dataPointsByCategories = this.buildDataPointsByCategoriesArray(this.allDataPoints);

        this.hasHighlight = this.allDataPoints.filter(x => x.highlight).length > 0;

        this.categoriesCount = this.dataPointsByCategories.length;

        this.createNormalChartElements();

        this.lassoSelection.init(this.mainElement);

        if (this.isLegendNeeded) {
            legendUtils.renderLegend(this.legend, this.mainSvgElement, options.viewport, this.legendProperties);
        } else {
            this.legendElement && this.legendElement.selectAll('*').remove();
            this.mainSvgElement && this.mainSvgElement
                .style('margin-top', 0)
                .style('margin-bottom', 0)
                .style('margin-left', 0)
                .style('margin-right', 0);
        }

        this.calculateOffsets(this.xAxisSvgGroup, this.yAxisSvgGroup);
        // calculate and set visual size and position
        this.calculateVisualSizeAndPosition();

        this.scrollBar.updateData(this.getScrollbarState(), options.type);

        const visibleDataPoints: VisualDataPoint[] = this.scrollBar.getVisibleDataPoints();

        let axes: IAxes = this.createAxes(visibleDataPoints);

        this.data = {
            dataPoints: visibleDataPoints,
            size: this.visualSize,
            axes: axes,
            categoriesCount: this.categoriesCount,
            legendData: this.legendProperties.data,
            hasHighlight: this.hasHighlight,
            isLegendNeeded: this.isLegendNeeded,
            isSmallMultiple: this.isSmallMultiple(),
        };

        // render for calculate width of labels text
        this.renderAxes();
        // Rerender for dynamic y-axis titles
        this.legendSize = this.isLegendNeeded ? this.calculateLegendSize(this.settings.legend, this.legendElementRoot) : null;

        this.calculateOffsets(this.xAxisSvgGroup, this.yAxisSvgGroup);
        this.calculateVisualSizeAndPosition(this.legendSize);
        this.calculateBarHeight();

        axes = this.createAxes(visibleDataPoints);
        this.data.size = this.visualSize;
        this.data.axes = axes;
        this.interactivityService.applySelectionStateToData(this.data.dataPoints);

        // calculate again after yScale changing
        this.calculateBarHeight();

        // calculate again after BarHeight changing
        axes = this.createAxes(visibleDataPoints);
        this.data.axes = axes;

        this.renderAxes(this.maxYLabelsWidth);
        this.finalRendering();

        this.scrollBar.update();

        const bars = this.barGroup.selectAll(Selectors.BarSelect.selectorName).data(visibleDataPoints);
        this.LassoSelectionForSmallMultiple.disable();
        this.lassoSelection.update(bars);

        if (this.settings.constantLine.show && this.settings.constantLine.value) {
            const yHeight: number = (<Element>this.xAxisSvgGroup.selectAll('line').node()).getBoundingClientRect().height;
            RenderVisual.renderConstantLine(this.settings.constantLine, this.barGroup, axes, yHeight);
        }
    }

    public update(options: VisualUpdateOptions) {
        if (!this.optionsAreValid(options)) {
            return;
        }

        const dataView = options && options.dataViews && options.dataViews[0];

        //  let isResized: boolean = this.isResized(options.type);

        //   this.maxYLabelsWidth = null;

        this.dataView = dataView;
        this.viewport = options.viewport;

        //if (!isResized) {
        this.isLegendNeeded = DataViewConverter.IsLegendNeeded(dataView);

        this.updateMetaData(this.dataView);

        this.settings = Visual.parseSettings(dataView);
        this.updateSettings(this.settings, dataView);

        this.legendProperties = legendUtils.setLegendProperties(dataView, this.host, this.settings.legend);

        this.allDataPoints = DataViewConverter.Convert(dataView, this.host, this.settings, this.legendProperties.colors);

        if (this.isSmallMultiple()) {
            this.smallMultipleProcess(options.viewport);
        } else {
            this.normalChartProcess(options);
        }

        if (!this.isSelectionRestored) {
            this.restoreSelection();

            this.isSelectionRestored = true;
        }
    }

    private restoreSelection(): void {
        const savedSelection = this.settings.selectionSaveSettings.selection;

        const selected: any[] = this.mainElement.selectAll(`.legendItem, ${Selectors.BarSelect.selectorName}`).data().filter(d => {
            return savedSelection.some(savedD => savedD.identity.key === (<any>d).identity.key);
        });

        if (selected.length > 0) {
            this.webBehaviorSelectionHandler.handleSelection(selected, false);
        }
    }

    getSettings(): VisualSettings {
        return this.settings;
    }

    getDataView(): DataView {
        return this.dataView;
    }

    getVisualSize(): ISize {
        return this.visualSize;
    }

    public getChartBoundaries(): ClientRect {
        return (<Element>this.clearCatcher.node()).getBoundingClientRect();
    }

    getVisualTranslation(): VisualTranslation {
        return this.visualTranslation;
    }

    getAllDataPoints(): VisualDataPoint[] {
        return this.allDataPoints;
    }

    getCategoriesCount(): number {
        return this.categoriesCount;
    }

    getDataPointsByCategories(): CategoryDataPoints[] {
        return this.dataPointsByCategories;
    }

    getLegendSize(): LegendSize {
        return this.legendSize;
    }

    private buildDataPointsByCategoriesArray(dataPoints: VisualDataPoint[]): CategoryDataPoints[] {
        const dataPointsByCategories: CategoryDataPoints[] = [];
        let categoryIndex: number = 0;
        let categoryName: string = '';
        let previousCategoryName: string = '';
        for (let i: number = 0; i < dataPoints.length; i++) {

            if (dataPoints[i].category == null) {
                continue;
            }

            previousCategoryName = categoryName;
            categoryName = dataPoints[i].category.toString();

            if (i > 0 && categoryName !== previousCategoryName) {
                categoryIndex++;
            }

            if (!dataPointsByCategories[categoryIndex]) {
                const category: CategoryDataPoints = {
                    categoryName,
                    dataPoints: [],
                };
                dataPointsByCategories[categoryIndex] = category;
            }
            dataPointsByCategories[categoryIndex].dataPoints.push(dataPoints[i]);
        }
        return dataPointsByCategories;
    }

    public onScrollPosChanged() {
        const visibleDataPoints: VisualDataPoint[] = this.scrollBar.getVisibleDataPoints();

        let axes: IAxes = this.createAxes(visibleDataPoints);
        const legendData = legendUtils.getSuitableLegendData(this.dataView, this.host, this.settings.legend);
        this.data = {
            dataPoints: visibleDataPoints,
            size: this.visualSize,
            axes: axes,
            categoriesCount: this.categoriesCount,
            legendData: legendData,
            hasHighlight: this.hasHighlight,
            isLegendNeeded: this.isLegendNeeded,
            isSmallMultiple: this.isSmallMultiple(),
        };

        // render for calculate width of labels text
        this.renderAxes();
        // Rerender for dynamic y-axis titles
        this.legendSize = this.isLegendNeeded ? this.calculateLegendSize(this.settings.legend, this.legendElementRoot) : null;
        this.calculateOffsets(this.xAxisSvgGroup, this.yAxisSvgGroup);
        this.calculateVisualSizeAndPosition(this.legendSize);

        this.calculateBarHeight();

        axes = this.createAxes(visibleDataPoints);
        this.data.size = this.visualSize;
        this.data.axes = axes;
        this.interactivityService.applySelectionStateToData(this.data.dataPoints);

        /*    // calculate again after yScale changing
            this.calculateBarHeight();

            // calculate again after BarHeight changing
            axes = this.createAxes(visibleDataPoints);
            this.data.axes = axes;*/

        this.renderAxes();
        this.finalRendering();
    }

    private updateMetaData(dataView: DataView): void {
        const grouped: DataViewValueColumnGroup[] = dataView.categorical.values.grouped();
        const source: DataViewMetadataColumn = dataView.metadata.columns[0];
        const categories: DataViewCategoryColumn[] = dataView.categorical.categories || [];
        this.metadata = metadataUtils.getMetadata(categories, grouped, source);
    }

    private getScrollbarState(): ScrollbarState {
        const categoryType = axis.getCategoryValueType(this.metadata.cols.category),
            isOrdinal: boolean = axis.isOrdinal(categoryType);

        return this.settings.categoryAxis.axisType === 'continuous' && !isOrdinal ? ScrollbarState.Disable : ScrollbarState.Enable;
    }

    private createAxes(dataPoints, isSmallMultiple = false): IAxes {
        const axesDomains: AxesDomains = RenderAxes.calculateAxesDomains(this.allDataPoints, dataPoints, this.settings, this.metadata, isSmallMultiple);

        const axes: IAxes = RenderAxes.createD3Axes(
            axesDomains,
            this.visualSize,
            this.metadata,
            this.settings,
            this.host,
            isSmallMultiple,
            this.BarHeight,
            this.maxYLabelsWidth,
        );

        return axes;
    }

    private createSmallMultipleAxesByDomains(categoryDomain: any[], valueDomain: any[], visualSize: ISize, maxYAxisLabelWidth: number, categoriesCount: number = null): IAxes {
        const axesDomains: AxesDomains = {
            xAxisDomain: valueDomain,
            yAxisDomain: categoryDomain,
        };
        const barHeight: number = categoriesCount ? visualSize.height / (categoriesCount > 2 ? categoriesCount + 1 : categoriesCount) : 0;

        const axes: IAxes = RenderAxes.createD3Axes(
            axesDomains,
            visualSize,
            this.metadata,
            this.settings,
            this.host,
            true,
            barHeight,
            maxYAxisLabelWidth,
        );

        return axes;
    }

    private calculateBarHeight(): void {
        this.BarHeight = visualUtils.calculateBarHeight(
            this.data.dataPoints,
            this.visualSize,
            this.data.categoriesCount,
            this.settings.categoryAxis.innerPadding,
            this.settings);
    }

    private getBarHeight(dataPoints: VisualDataPoint[], visualSize: ISize, categoriesNumber: number): number {
        return visualUtils.calculateBarHeight(
            dataPoints,
            visualSize,
            categoriesNumber,
            this.settings.categoryAxis.innerPadding,
            this.settings);
    }

    private renderAxes(maxYLabelsWidth = null): void {
        visualUtils.calculateBarCoordianatesByData(this.data, this.settings, this.BarHeight);

        this.calculateBarHeight();
        RenderAxes.render(
            this.settings,
            this.xAxisSvgGroup,
            this.yAxisSvgGroup,
            this.data.axes,
            maxYLabelsWidth,
        );
    }

    private renderSmallMultipleAxes(dataPoints: VisualDataPoint[], axes: IAxes, xAxisSvgGroup: d3Selection<SVGElement>, yAxisSvgGroup: d3Selection<SVGElement>, barHeight: number): void {
        visualUtils.calculateBarCoordianates(dataPoints, axes, this.settings, barHeight, true);

        RenderAxes.render(
            this.settings,
            xAxisSvgGroup,
            yAxisSvgGroup,
            axes,
        );
    }

    private finalRendering(): void {
        // render axes labels
        RenderAxes.renderLabels(
            this.viewport,
            this.visualMargin,
            this.visualSize,
            [this.data.axes.x.axisLabel, this.data.axes.y.axisLabel],
            this.settings,
            this.data.axes,
            this.axisLabelsGroup,
            this.axisGraphicsContext);

        visualUtils.calculateBarCoordianatesByData(this.data, this.settings, this.BarHeight);
        // render main visual
        RenderVisual.render(
            this.data,
            this.barGroup,
            this.clearCatcher,
            this.interactivityService,
            this.behavior,
            this.tooltipServiceWrapper,
            this.host,
            this.hasHighlight,
            this.settings,
        );

        const chartWidth: number = (<Element>this.xAxisSvgGroup.node()).getBoundingClientRect().width -
            (<Element>this.xAxisSvgGroup.selectAll('text').nodes()[0]).getBoundingClientRect().width;

        visualUtils.calculateLabelCoordinates(
            this.data,
            this.settings.categoryLabels,
            this.metadata,
            chartWidth,
            this.isLegendNeeded,
        );

        RenderVisual.renderDataLabelsBackground(
            this.data,
            this.settings,
            this.labelBackgroundContext,
        );

        RenderVisual.renderDataLabels(
            this.data,
            this.settings,
            this.labelGraphicsContext,
            this.metadata,
        );
    }

    private calculateLegendSize(settings: legendSettings, legendElementRoot: d3Selection<SVGElement>): LegendSize {
        // if 'width' or 'height' is '0' it means that we don't need that measure for our calculations
        switch (settings.position) {
            case 'Top':
            case 'TopCenter':
            case 'Bottom':
            case 'BottomCenter':
                return {
                    width: 0,
                    height: (legendElementRoot.node() as SVGGraphicsElement).getBBox().height,
                };
            case 'Left':
            case 'LeftCenter':
            case 'Right':
            case 'RightCenter':
                return {
                    width: (legendElementRoot.node() as SVGGraphicsElement).getBBox().width,
                    height: 0,
                };
            default:
                return {
                    width: 0,
                    height: 0,
                };
        }
    }

    private updateSettings(settings: VisualSettings, dataView: DataView) {
        const MAX_INNER_PADDING = 50;

        const MAX_CATEGORY_WIDTH = 180;
        const MIN_CATEGORY_WIDTH = 20;

        const MAX_Y_AXIS_WIDTH = 50;
        const MIN_Y_AXIS_WIDTH = 15;

        const MIN_UNIT_WIDTH = 150;
        const MIN_UNIT_HEIGHT = 120;

        // for legend
        if (this.settings.legend.legendName.length === 0) {
            if (dataView.categorical.values.source) {
                settings.legend.legendName = dataView.categorical.values.source.displayName;
            }
        }

        if (this.isLegendNeeded) {
            settings.categoryLabels.labelPosition = settings.categoryLabels.labelPositionForFilledLegend;

            if (settings.categoryLabels.labelPosition === LabelPosition.OutsideEnd) {
                settings.categoryLabels.labelPosition = LabelPosition.Auto;
                settings.categoryLabels.labelPositionForFilledLegend = LabelPosition.Auto;
            }
        }

        if (this.isSmallMultiple() && (!visualUtils.categoryIsScalar(this.metadata) || this.settings.categoryAxis.axisType === 'categorical')) {
            settings.categoryAxis.rangeType = settings.categoryAxis.rangeTypeNoScalar;
        }
        // for Y-axis
        const yAxis = settings.categoryAxis;

        if (yAxis.innerPadding > MAX_INNER_PADDING) {
            yAxis.innerPadding = MAX_INNER_PADDING;
        }

        if (yAxis.minCategoryWidth < MIN_CATEGORY_WIDTH) {
            yAxis.minCategoryWidth = MIN_CATEGORY_WIDTH;
        }
        if (yAxis.minCategoryWidth > MAX_CATEGORY_WIDTH) {
            yAxis.minCategoryWidth = MAX_CATEGORY_WIDTH;
        }

        if (yAxis.maximumSize < MIN_Y_AXIS_WIDTH) {
            yAxis.maximumSize = MIN_Y_AXIS_WIDTH;
        }
        if (yAxis.maximumSize > MAX_Y_AXIS_WIDTH) {
            yAxis.maximumSize = MAX_Y_AXIS_WIDTH;
        }

        if (yAxis.showTitle && yAxis.axisTitle.length === 0) {
            const categories = dataView.categorical.categories;
            yAxis.axisTitle = categories ? categories[0].source.displayName : dataView.categorical.values.source.displayName;
        }
        if (!yAxis.showTitle) {
            yAxis.axisTitle = '';
        }

        if (typeof settings.selectionSaveSettings.selection === 'string') {
            settings.selectionSaveSettings.selection = JSON.parse(settings.selectionSaveSettings.selection);
        }

        if (settings.smallMultiple.minUnitHeight < MIN_UNIT_HEIGHT) {
            settings.smallMultiple.minUnitHeight = MIN_UNIT_HEIGHT;
        }

        if (settings.smallMultiple.minUnitWidth < MIN_UNIT_WIDTH) {
            settings.smallMultiple.minUnitWidth = MIN_UNIT_WIDTH;
        }
    }

    private calculateOffsets(xAxisSvgGroup: d3Selection<SVGElement>, yAxisSvgGroup: d3Selection<SVGElement>) {
        const xtickText: visualUtils.d3Group<any> = xAxisSvgGroup.selectAll('text');
        const ytickText: visualUtils.d3Group<any> = yAxisSvgGroup.selectAll('text');

        const showYAxisTitle: boolean = this.settings.categoryAxis.show && this.settings.categoryAxis.showTitle;
        const showXAxisTitle: boolean = this.settings.valueAxis.show && this.settings.valueAxis.showTitle;

        this.yTickOffset = visualUtils.getLabelsMaxWidth(ytickText) + (showYAxisTitle ?
            PixelConverter.fromPointToPixel(this.settings.categoryAxis.titleFontSize) : 0);

        this.xTickOffset = visualUtils.getLabelsMaxHeight(xtickText) + (showXAxisTitle ?
            PixelConverter.fromPointToPixel(this.settings.valueAxis.titleFontSize) : 0);
    }

    private calculateVisualSizeAndPosition(legendSize: LegendSize = null) {
        // Update the size of our SVG element
        if (this.mainSvgElement) {
            this.mainSvgElement
                .attr('width', this.viewport.width)
                .attr('height', this.viewport.height);
        }

        this.calculateVisualMargin();

        const showYAxisTitle: boolean = this.settings.categoryAxis.show && this.settings.categoryAxis.showTitle;
        const xAxisTitleThickness: number = showYAxisTitle ? visualUtils.GetXAxisTitleThickness(this.settings.categoryAxis) + 5 : 0;

        this.calculateVisualSize(legendSize, xAxisTitleThickness);

        const yAxisMaxWidth = axisUtils.getYAxisMaxWidth(this.visualSize.width + this.yTickOffset, this.settings);
        if (this.yTickOffset > yAxisMaxWidth + xAxisTitleThickness) {
            this.yTickOffset = yAxisMaxWidth + xAxisTitleThickness;

            this.maxYLabelsWidth = yAxisMaxWidth;
        }

        this.calculateVisualPosition();
    }

    private calculateVisualMargin(): void {
        const yHasRightPosition: boolean = this.settings.categoryAxis.show && this.settings.categoryAxis.position === 'right';
        const extendedLeftMargin: boolean = yHasRightPosition || !this.settings.categoryAxis.show;
        const extendedRightMargin: boolean = !yHasRightPosition || !this.settings.categoryAxis.show;

        // Set up margins for our visual
        this.visualMargin = {top: 5, bottom: 5, left: extendedLeftMargin ? 15 : 5, right: extendedRightMargin ? 15 : 5};
    }

    private calculateVisualSize(legendSize: LegendSize, xAxisTitleThickness: number): void {
        const visualSize: ISize = {
            width: this.viewport.width
                - this.visualMargin.left
                - this.visualMargin.right
                - this.axesSize.yAxisWidth
                - (legendSize === null ? 0 : legendSize.width)
                - this.yTickOffset
                - (this.scrollBar.isEnabled() ? this.scrollBar.settings.trackSize + this.scrollBar.settings.trackMargin : 0),
            height: this.viewport.height
                - this.visualMargin.top
                - this.visualMargin.bottom
                - this.axesSize.xAxisHeight
                - (legendSize === null ? 0 : legendSize.height)
                - this.xTickOffset,
        };

        // set maximum Y-labels width according to the Y-axis formatting options (maximumSize parameter)
        const yAxisMaxWidth = axisUtils.getYAxisMaxWidth(visualSize.width + this.yTickOffset, this.settings);
        if (this.yTickOffset > yAxisMaxWidth + xAxisTitleThickness) {
            // 2. if max width exceeded —— change visual width and offset
            visualSize.width = visualSize.width + this.yTickOffset - yAxisMaxWidth - xAxisTitleThickness;
        }

        this.visualSize = visualSize;
    }

    private calculateVisualPosition(): void {
        // Translate the SVG group to account for visual's margins
        this.chartsContainer.attr(
            'transform',
            `translate(${this.visualMargin.left}, ${this.visualMargin.top})`);

        // Move SVG group elements to appropriate positions.
        this.visualTranslation = {
            x: this.visualMargin.left,// + (yHasRightPosition ? 0 : axesSize.yAxisWidth + this.yTickOffset),
            y: this.visualMargin.top,
        };

        /*this.chartsContainer.attr(
            "transform",
            svg.translate(this.visualTranslation.x + (yHasRightPosition ? rightPadding : 0), this.visualTranslation.y));*/

        const yHasLeftPosition: boolean = this.settings.categoryAxis.show && this.settings.categoryAxis.position === 'left';

        const translateX: number = yHasLeftPosition ? this.axesSize.yAxisWidth + this.yTickOffset : 0;

        this.xAxisSvgGroup.attr(
            'transform',
            svg.translate(
                translateX,
                this.visualMargin.top + this.visualSize.height));

        this.yAxisSvgGroup.attr(
            'transform',
            svg.translate(
                (yHasLeftPosition ? this.axesSize.yAxisWidth + this.yTickOffset : this.visualSize.width),
                this.visualMargin.top));

        this.barGroup.attr(
            'transform',
            svg.translate(
                translateX,
                this.visualMargin.top));

        this.labelGraphicsContext.attr(
            'transform',
            svg.translate(
                translateX,
                this.visualMargin.top));

        this.labelBackgroundContext.attr(
            'transform',
            svg.translate(
                translateX,
                this.visualMargin.top));
    }

    private static parseSettings(dataView: DataView): VisualSettings {
        return VisualSettings.parse(dataView) as VisualSettings;
    }

    /**
     * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
     * objects and properties you want to expose to the users in the property pane.
     *
     */
    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        const instanceEnumeration: VisualObjectInstanceEnumeration = VisualSettings.enumerateObjectInstances(this.settings || VisualSettings.getDefault(), options);

        const instances: VisualObjectInstance[] = (instanceEnumeration as VisualObjectInstanceEnumerationObject).instances;
        const instance: VisualObjectInstance = instances[0];

        if (instance.objectName === 'legend' && !this.isLegendNeeded) {
            return null;
        }

        if (instance.objectName === 'smallMultiple' && !this.isSmallMultiple()) {
            return null;
        }

        EnumerateObject.setInstances(this.settings, instanceEnumeration, this.data.axes.yIsScalar, this.data);

        return instanceEnumeration;
    }
}
