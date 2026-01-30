

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import "./style.css";
import { hexbin } from "d3-hexbin";


/* =======================
   DATA TYPE (FIXED)
   ======================= */
type SpotifyRow = {
  track_popularity: number;
  track_duration_ms: number;
  artist_name: string;
  artist_popularity: number;
  artist_followers: number;
  artist_genres: string;
};

export default function App() {
  const [data, setData] = useState<SpotifyRow[]>([]);

  const view1Ref = useRef<SVGSVGElement | null>(null);
  const view2Ref = useRef<SVGSVGElement | null>(null);
  const view3Ref = useRef<SVGSVGElement | null>(null);

  /* =======================
     LOAD DATA
     ======================= */
  useEffect(() => {
    d3.csv("/data/spotify.csv", d3.autoType).then(d => {
      setData(d as SpotifyRow[]);
    });
  }, []);



  /* =========================================================
     VIEW 1 — OVERVIEW: Popularity vs Track Duration
     ========================================================= */
  useEffect(() => {
    if (!data.length || !view1Ref.current) return;

    const svg = d3.select(view1Ref.current);
    svg.selectAll("*").remove();

    const width = 900;
    const height = 260;
    const margin = { top: 40, right: 30, bottom: 50, left: 60 };

    // const x = d3.scaleLinear()
    //   .domain(
    //     d3.extent(data, d => d.track_duration_ms / 60000) as [number, number]
    //   )
    //   .range([margin.left, width - margin.right]);

    const x = d3.scaleLinear()
  .domain([0, 7])                 // focus on typical track lengths
  .range([margin.left, width - margin.right])
  .clamp(true);


    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);

    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const points = data.map(d => [
      x(d.track_duration_ms / 60000),
      y(d.track_popularity)
    ]);

    const hex = hexbin()
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
      .radius(8);

    const bins = hex(points);

    const color = d3.scaleSequential(d3.interpolateBlues)
      .domain([0, d3.max(bins, d => d.length)!]);

      

    svg.append("g")
      .selectAll("path")
      .data(bins)
      .enter()
      .append("path")
      .attr("d", hex.hexagon())
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .attr("fill", d => color(d.length))
      .attr("stroke", "white")
      .attr("stroke-width", 0.3);


    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6));

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("class", "title")
      .text("Popularity vs Track Duration (Overview)");

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text("Song/Track Duration (minutes)");

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text("Track Popularity");
  }, [data]);

  /* =========================================================
     VIEW 2 — FOCUS: Artist Attention
     ========================================================= */
  useEffect(() => {
    if (!data.length || !view2Ref.current) return;

    const svg = d3.select(view2Ref.current);
    svg.selectAll("*").remove();

    const width = 450;
    const height = 320;
    const margin = { top: 40, right: 40, bottom: 40, left: 150 };

    const topArtists = d3.rollups(
      data,
      v => d3.mean(v, d => d.artist_followers)!,
      d => d.artist_name
    )
      .sort((a, b) => d3.descending(a[1], b[1]))
      .slice(0, 10);

    const x = d3.scaleLinear()
      .domain([0, d3.max(topArtists, d => d[1])!])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
      .domain(topArtists.map(d => d[0]))
      .range([margin.top, height - margin.bottom])
      .padding(0.25);

    const colorScale = d3.scaleThreshold<number, string>()
      .domain([100_000_000, 110_000_000, 120_000_000, 130_000_000])
      .range([
        "#deebf7", // < 100M 
        "#9eb8d1", // 100–110M
        "#6d9eba", // 110–120M
        "#3f7dba", // 120–130M
        "#12538c"  // 130M+ 
      ]);


    


    svg.attr("viewBox", `0 0 ${width} ${height}`);

    svg.append("g")
      .selectAll("rect")
      .data(topArtists)
      .enter()
      .append("rect")
      .attr("x", margin.left)
      .attr("y", d => y(d[0])!)
      .attr("width", d => x(d[1]) - margin.left)
      .attr("height", y.bandwidth())
      .attr("fill", d => colorScale(d[1]))


    svg.append("g")
      .selectAll("text")
      .data(topArtists)
      .enter()
      .append("text")
      .attr("x", d => x(d[1]) + 5)
      .attr("y", d => y(d[0])! + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("font-size", 11)
      .text(d => `${(d[1] / 1_000_000).toFixed(1)}M`);

    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(
        d3.axisBottom(x)
          .ticks(4)
          .tickFormat(d => `${Number(d) / 1_000_000}M`)
      );

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y));

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("class", "title")
      .text("Top 10 Artists with the Highest Follower counts");

    svg.append("text")
  .attr("x", (margin.left + width - margin.right) / 2)
  .attr("y", height - 5)
  .attr("text-anchor", "middle")
  .attr("font-size", 11)
  .text("Artist Followers Counts");
svg.append("text")
  .attr("transform", "rotate(-90)")
  .attr("x", -(margin.top + height - margin.bottom) / 2)
  .attr("y", 20)
  .attr("text-anchor", "middle")
  .attr("font-size", 11)
  .text("Artist");
  }, [data]);


/* =========================================================
   VIEW 3 — ADVANCED: Multivariate Structure (Parallel Coords)
   ========================================================= */
useEffect(() => {
  if (!data.length || !view3Ref.current) return;

  const svg = d3.select(view3Ref.current);
  svg.selectAll("*").remove();

  const width = 450;
  const height = 320;
  const margin = { top: 50, right: 40, bottom: 40, left: 50 };

  // ---- Subsample to reduce clutter
  const sampled = d3.shuffle([...data]).slice(0, 700);

  // ---- Dimensions
  const dimensions = [
    {
      key: "track_popularity",
      label: "Track Popularity",
      scale: d3.scaleLinear().domain([0, 100])
    },
    {
      key: "artist_popularity",
      label: "Artist Popularity",
      scale: d3.scaleLinear().domain([0, 100])
    },
    {
      key: "artist_followers",
      label: "Artist Followers",
      scale: d3.scaleLog().domain([1e5, 2e8])
    }
  ];

  dimensions.forEach(d =>
    d.scale.range([height - margin.bottom, margin.top])
  );

  const x = d3.scalePoint()
    .domain(dimensions.map(d => d.key))
    .range([margin.left, width - margin.right]);

  const line = d3.line<[number, number]>();

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  // ---- Popularity thresholds
  const p75 = d3.quantile(sampled.map(d => d.track_popularity).sort(d3.ascending), 0.75)!;
  const p90 = d3.quantile(sampled.map(d => d.track_popularity).sort(d3.ascending), 0.9)!;

const strokeColor = (d: SpotifyRow) => {
  if (d.track_popularity >= p90) return "#2166ac";   // muted dark blue
  if (d.track_popularity >= p75) return "#72a6c1";   // light blue
  return "#a8b6c7";                                  // light gray
};

const strokeOpacity = (d: SpotifyRow) =>
  d.track_popularity >= p90 ? 0.55 :
  d.track_popularity >= p75 ? 0.18 : 0.08;

const strokeWidth = (d: SpotifyRow) =>
  d.track_popularity >= p90 ? 1.4 :
  d.track_popularity >= p75 ? 0.9 : 0.5;


  // ---- Draw background + highlighted lines
  svg.append("g")
    .selectAll("path")
    .data(sampled)
    .enter()
    .append("path")
    .attr("d", d =>
      line(
        dimensions.map(dim => [
          x(dim.key)!,
          dim.scale(d[dim.key as keyof SpotifyRow]!)
        ])
      )!
    )
    .attr("fill", "none")
    .attr("stroke", d => strokeColor(d))
    .attr("stroke-opacity", d => strokeOpacity(d))
    .attr("stroke-width", d => strokeWidth(d));

  // ---- Median profile
  const medians = dimensions.map(dim =>
    d3.median(sampled, d => d[dim.key as keyof SpotifyRow]!)!
  );

  svg.append("path")
    .attr(
      "d",
      line(
        dimensions.map((dim, i) => [
          x(dim.key)!,
          dim.scale(medians[i])
        ])
      )!
    )
    .attr("fill", "none")
    .attr("stroke", "#d62728")
    .attr("stroke-width", 3);

  svg.append("text")
    .attr("x", x("artist_popularity")! + 6)
    .attr("y", dimensions[1].scale(medians[1]) - 8)
    .attr("fill", "#d62728")
    .attr("font-size", 11)
    .attr("font-weight", "bold")
    .text("Median track profile");

  // ---- Axes + labels
  dimensions.forEach(dim => {
    svg.append("g")
      .attr("transform", `translate(${x(dim.key)},0)`)
      .call(d3.axisLeft(dim.scale).ticks(4));

    svg.append("text")
      .attr("x", x(dim.key))
      .attr("y", height - 8)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "bold")
      .text(dim.label);

    svg.append("text")
      .attr("x", x(dim.key))
      .attr("y", margin.top - 12)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "#555")
      // .text("Higher ↑");
  });

  // ---- Title
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 22)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text("Multivariate Structure of Track Success");

}, [data]);

return (
  <div id="main-container">
    {/* SHARED LEGEND */}
    <div className="legend">
      <strong>Legend</strong><br />
      <span style={{ color: "#bdbdbd" }}>■</span> Lower popularity / attention<br />
      <span style={{ color: "#9ecae1" }}>■</span> Higher popularity / attention<br />
      <span style={{ color: "#2171b5" }}>■</span> Highest popularity / attention<br />
      <span style={{ color: "#d62728" }}>━</span> Median / summary
    </div>

    {/* Top: Overview */}
    <div id="overview-row" className="chart-container">
      <svg ref={view1Ref} />
    </div>

    {/* Bottom: Focus + Advanced */}
    <div id="bottom-row">
      <div className="chart-container">
        <svg ref={view2Ref} />
      </div>
      <div className="chart-container">
        <svg ref={view3Ref} />
      </div>
    </div>
  </div>
);
}