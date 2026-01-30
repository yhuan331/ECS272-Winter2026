

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
     VIEW 1 — Popularity vs Track Duration
     ========================================================= */
  useEffect(() => {
    if (!data.length || !view1Ref.current) return;

    const svg = d3.select(view1Ref.current);
    svg.selectAll("*").remove();

    const width = 900;
    const height = 260;
    const margin = { top: 40, right: 30, bottom: 50, left: 60 };

 

    const x = d3.scaleLinear()
  .domain([0, 7])              
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
      .text("Track Duration vs Popularity");

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height - 10)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text("Track Duration (minutes)");

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

    const width = 400;
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


// /* =========================================================
//    VIEW 3 — ADVANCED: Multivariate Structure (Parallel Coords)
//    ========================================================= */

useEffect(() => {
  if (!data.length || !view3Ref.current) return;

  const svg = d3.select(view3Ref.current);
  svg.selectAll("*").remove();

  const width = 600;
  const height = 320;
  const margin = { top: 50, right: 120, bottom: 40, left: 50 };

  svg.attr("viewBox", `0 0 ${width} ${height}`);


  const getPrimaryGenre = (g: string) => {
    if (!g) return "other";
    return g
      .replace(/[\[\]']/g, "")
      .split(",")[0]
      ?.trim() || "other";
  };


  const filtered = data.filter(d => d.artist_followers > 1_000_000);

  const genreCounts = d3.rollups(
    filtered,
    v => v.length,
    d => getPrimaryGenre(d.artist_genres)
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 10);

  const topGenres = genreCounts.map(d => d[0]);

  const sampled = filtered.filter(d =>
    topGenres.includes(getPrimaryGenre(d.artist_genres))
  );

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
      scale: d3.scaleLog().domain([1e6, 2e8])
    }
  ];

  dimensions.forEach(d =>
    d.scale.range([height - margin.bottom, margin.top])
  );

  const x = d3.scalePoint()
    .domain(dimensions.map(d => d.key))
    .range([margin.left, width - margin.right]);

  const line = d3.line<[number, number]>();

const tableauNoRed = d3.schemeTableau10.filter(
  c => c.toLowerCase() !== "#e15759"
);

const genreColors: Record<string, string> = {
  other: "#aba9a9",      
  pop: tableauNoRed[0],
  rap: tableauNoRed[1],
  "soft pop": tableauNoRed[2],
  country: tableauNoRed[3],
  "art pop": tableauNoRed[4],
  edm: tableauNoRed[5],
  grunge: tableauNoRed[6],
  "k-pop": tableauNoRed[7],
  soundtrack: "#5acba0"
};

const color = (genre: string) =>
  genreColors[genre] ?? "#bdbdbd";


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
    .attr("stroke", d => color(getPrimaryGenre(d.artist_genres)))
    .attr("stroke-opacity", 0.15)
    .attr("stroke-width", 0.8);


  const averages = dimensions.map(dim =>
    d3.mean(sampled, d => d[dim.key as keyof SpotifyRow]!)!
  );

  svg.append("path")
    .attr("d",
      line(
        dimensions.map((dim, i) => [
          x(dim.key)!,
          dim.scale(averages[i])
        ])
      )!
    )
    .attr("fill", "none")
    .attr("stroke", "#d62728")
    .attr("stroke-width", 3);


const avgLegend = svg.append("g")
  .attr(
    "transform",
    `translate(${width - margin.right + 10}, ${margin.top + topGenres.length * 16 + 30})`
  );

// Title
avgLegend.append("text")
  .attr("x", 0)
  .attr("y", -6)
  .attr("font-size", 11)
  .attr("font-weight", "bold")
  .text("Reference");

// Red line sample
avgLegend.append("line")
  .attr("x1", 0)
  .attr("x2", 18)
  .attr("y1", 6)
  .attr("y2", 6)
  .attr("stroke", "#d62728")
  .attr("stroke-width", 2);

// Label
avgLegend.append("text")
  .attr("x", 24)
  .attr("y", 9)
  .attr("font-size", 10)
  .text("Average track profile");


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
  });


  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 22)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text("Multivariate Structure of Track Success");


  const legend = svg.append("g")
    .attr("transform", `translate(${width - margin.right + 10},${margin.top})`);

  legend.append("text")
    .attr("x", 0)
    .attr("y", -10)
    .attr("font-size", 11)
    .attr("font-weight", "bold")
    .text("Primary Genre");

  topGenres.forEach((g, i) => {
    const row = legend.append("g")
      .attr("transform", `translate(0, ${i * 16})`);

    row.append("rect")
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", color(g));

    row.append("text")
      .attr("x", 14)
      .attr("y", 9)
      .attr("font-size", 10)
      .text(g);
  });

}, [data]);

return (
  <div id="main-container">

    {/* TOP ROW: MULTIVARIATE + FOCUS */}
    <div id="top-row">
      <div className="chart-container">
        <svg ref={view3Ref} />
      </div>

      <div className="chart-container">
        <svg ref={view2Ref} />
      </div>
    </div>

   <div id="overview-row">
  <div className="chart-container overview-container">
    <svg ref={view1Ref} />

    <div className="legend legend-inside">
      <strong>Legend</strong><br />
      <span style={{ color: "#bdbdbd" }}>■</span> Lower popularity<br />
      <span style={{ color: "#9ecae1" }}>■</span> Higher popularity<br />
      <span style={{ color: "#2171b5" }}>■</span> Highest popularity<br />
    </div>
  </div>
</div>



  </div>
);
}
