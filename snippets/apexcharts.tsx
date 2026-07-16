import * as React from 'react';
import type { ApexOptions } from 'apexcharts';
import ReactApexChart from 'react-apexcharts';

type SeriesPoint = number[];
type RtlChartOptions = ApexOptions & {
  chart?: ApexOptions['chart'] & {
    rtl?: boolean;
  };
};

interface AnalyticsChartsProps {
  rtl?: boolean;
  primaryColor?: string;
}

const categories = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function createBaseOptions(rtl: boolean, primaryColor: string): RtlChartOptions {
  return {
    chart: {
      fontFamily: 'inherit',
      toolbar: {
        show: true
      },
      rtl
    },
    colors: [primaryColor, '#38bdf8', '#22c55e'],
    dataLabels: {
      enabled: false
    },
    grid: {
      borderColor: '#e2e8f0'
    },
    responsive: [
      {
        breakpoint: 768,
        options: {
          legend: {
            position: 'bottom'
          }
        }
      }
    ],
    stroke: {
      curve: 'smooth',
      width: 3
    },
    xaxis: {
      categories,
      labels: {
        rotate: rtl ? 15 : -15
      }
    },
    yaxis: {
      labels: {
        formatter: (value) => `${value}`
      }
    },
    tooltip: {
      theme: 'light'
    }
  };
}

export function AnalyticsCharts({
  rtl = false,
  primaryColor = '#0052cc'
}: AnalyticsChartsProps) {
  const lineOptions = React.useMemo(
    () => ({
      ...createBaseOptions(rtl, primaryColor),
      title: {
        text: 'Line Chart'
      }
    }),
    [primaryColor, rtl]
  );

  const barOptions = React.useMemo(
    () => ({
      ...createBaseOptions(rtl, primaryColor),
      chart: {
        ...createBaseOptions(rtl, primaryColor).chart,
        type: 'bar',
        rtl
      },
      plotOptions: {
        bar: {
          borderRadius: 6,
          horizontal: false
        }
      },
      title: {
        text: 'Bar Chart'
      }
    }),
    [primaryColor, rtl]
  );

  const areaOptions = React.useMemo(
    () => ({
      ...createBaseOptions(rtl, primaryColor),
      chart: {
        ...createBaseOptions(rtl, primaryColor).chart,
        type: 'area',
        rtl
      },
      fill: {
        type: 'gradient',
        gradient: {
          opacityFrom: 0.45,
          opacityTo: 0.05
        }
      },
      title: {
        text: 'Area Chart'
      }
    }),
    [primaryColor, rtl]
  );

  const lineSeries = [{ name: 'Revenue', data: [22, 35, 41, 53, 49, 61] as SeriesPoint }];
  const barSeries = [{ name: 'Orders', data: [12, 18, 15, 22, 28, 24] as SeriesPoint }];
  const areaSeries = [{ name: 'Visits', data: [120, 150, 180, 170, 210, 240] as SeriesPoint }];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <ChartCard title="Line">
        <ReactApexChart type="line" height={300} options={lineOptions} series={lineSeries} />
      </ChartCard>
      <ChartCard title="Bar">
        <ReactApexChart type="bar" height={300} options={barOptions} series={barSeries} />
      </ChartCard>
      <ChartCard title="Area">
        <ReactApexChart type="area" height={300} options={areaOptions} series={areaSeries} />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-4 text-lg font-semibold text-slate-900">{title}</header>
      {children}
    </section>
  );
}
